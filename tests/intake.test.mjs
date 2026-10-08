import test from "node:test";
import assert from "node:assert/strict";
import {makeIntake} from "../service/intake.mjs";
import {createHttpHandler} from "../service/http.mjs";
import {normalizeReport, IntakeError} from "../service/report-domain.mjs";

const key = "124e4567-e89b-42d3-a456-426614174000";
const origin="https://vitium.echelonfoundry.com";
const valid = (patch={})=>({
  schemaVersion:"1.0", product:"Forma",
  impact:"Cannot use the feature",
  title:"Cannot save a change",actual:"Save does nothing.",
  expected:"Changes should be saved.",steps:"Open form.\nTap save.",
  pageUrl:"https://example.com/path?token=secret#private",
  privacyAcknowledged:true,...patch
});
function memoryStore() {
  const records=new Map();
  return {
    records,
    async putOnce(item) {
      if (records.has(item.pk)) return {created:false,existing:records.get(item.pk)};
      records.set(item.pk,item);
      return {created:true};
    }
  };
}
function fixture(deps={}){
  const store=deps.store||memoryStore();
  const service=makeIntake({
    store,verifyChallenge:deps.verifyChallenge|| (async()=>true),
    now:()=> "2026-10-08T12:00:00.000Z",
    reference:()=> "VIT-00112233445566778899AABBCCDDEEFF"
  });
  return {store,service,handle:createHttpHandler(service)};
}
const http=(body, overrides={})=>({
  rawPath:"/api/v1/reports",requestContext:{http:{method:"POST"},requestId:"req-safe"},
  headers:{origin,"content-type":"application/json","idempotency-key":key},
  body: JSON.stringify({...body,challengeToken:"challenge-token-example-123"}),
  ...overrides
});
test("accepted private intake is durable before a receipt is returned",async()=>{
  const {store,handle}=fixture();
  const reply=await handle(http(valid()));
  assert.equal(reply.statusCode,201);
  const body=JSON.parse(reply.body);
  assert.equal(body.status,"received");
  assert.ok(body.reference.startsWith("VIT-"));
  assert.ok(!reply.body.includes("Save does nothing"));
  assert.equal(store.records.size,1);
  const entry=[...store.records.values()][0];
  assert.equal(entry.visibility,"private");
  assert.equal(entry.kind,"observation");
  assert.equal(entry.source,"public-api");
  assert.equal(entry.report.pageUrl,"https://example.com/path");
  assert.ok(!JSON.stringify(entry).includes("token=secret"));
});
test("same request is idempotent without creating a second report",async()=>{
  const {store,handle}=fixture();
  const first=JSON.parse((await handle(http(valid()))).body);
  const duplicate=await handle(http(valid()));
  assert.equal(duplicate.statusCode,200);
  assert.equal(JSON.parse(duplicate.body).reference,first.reference);
  assert.equal(JSON.parse(duplicate.body).replayed,true);
  assert.equal(store.records.size,1);
});
test("reuse of idempotency key with different report content is a conflict",async()=>{
  const {handle}=fixture();
  await handle(http(valid()));
  const r=await handle(http(valid({title:"A different report"})));
  assert.equal(r.statusCode,409);
  assert.equal(JSON.parse(r.body).code,"request_conflict");
});
test("challenge failure blocks storage; provider outage returns retryable error",async()=>{
  for (const [verify,code] of [[async()=>false,"challenge_failed"],[async()=>{throw Error("provider secret")}, "challenge_unavailable"]]){
    const {store,handle}=fixture({verifyChallenge:verify});
    const r=await handle(http(valid()));
    assert.equal(JSON.parse(r.body).code,code);
    assert.equal(store.records.size,0);
    assert.ok(!r.body.includes("provider secret"));
  }
});
test("durability failure refuses acknowledgement and does not leak infrastructure errors",async()=>{
  const {handle}=fixture({store:{async putOnce(){throw Error("Dynamo connection password = private")}}});
  const r=await handle(http(valid()));
  assert.equal(r.statusCode,503);
  assert.equal(JSON.parse(r.body).code,"storage_unavailable");
  assert.ok(!r.body.includes("private"));
});
test("server rejects secrets, unauthorized URL forms and invalid products",()=>{
  for (const payload of [
    valid({title:"sk-abcdefghijklmnopqrstuvwxyz"}),
    valid({actual:"password: secretvalue"}),
    valid({pageUrl:"javascript:alert(1)"}),
    valid({product:"nonexistent"}),
    valid({privacyAcknowledged:false}),
    valid({schemaVersion:"2.0"})
  ]) assert.throws(()=>normalizeReport(payload),IntakeError);
});
test("origin, method, type, invalid json, large input, idempotency and short challenge are refused",async()=>{
  const {handle}=fixture();
  const cases=[
    [http(valid(),{headers:{origin:"https://attacker.example","content-type":"application/json","idempotency-key":key}}),403],
    [http(valid(),{rawPath:"/private/admin"}),404],
    [http(valid(),{headers:{origin,"content-type":"text/plain","idempotency-key":key}}),415],
    [http(valid(),{body:"{"}),400],
    [http(valid(),{body:"x".repeat(20000)}),413],
    [http(valid(),{headers:{origin,"content-type":"application/json","idempotency-key":"bad"}}),400],
    [http(valid({challengeToken:"bad"}),{body:JSON.stringify({...valid(),challengeToken:"short"})}),403]
  ];
  for (const [req,status] of cases) {
    const r=await handle(req);
    assert.equal(r.statusCode,status,req.rawPath);
    assert.ok(r.headers["cache-control"]==="no-store");
  }
});
test("no report is persisted if client changes after validation fails",async()=>{
  const {store,handle}=fixture();
  let r=await handle(http(valid({actual:""})));
  assert.equal(r.statusCode,400);
  assert.equal(store.records.size,0);
  r=await handle(http(valid({title:"Corrected report"})));
  assert.equal(r.statusCode,201);
  assert.equal(store.records.size,1);
});
test("parallel deliveries with same identifier converge to one stored receipt",async()=>{
  const {store,handle}=fixture();
  const results=await Promise.all(Array.from({length:10},()=>handle(http(valid()))));
  assert.equal(store.records.size,1);
  assert.equal(new Set(results.map(x=>JSON.parse(x.body).reference)).size,1);
});
