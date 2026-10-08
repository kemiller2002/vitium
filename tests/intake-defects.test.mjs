// Regression tests for intake defects found in the P0 security audit (issue #1).
// Each test was written and run against baseline bba1d59 BEFORE the fix and failed;
// see docs/security/INTAKE-THREAT-MODEL.md for the defect register (D-01..D-05).
import test from "node:test";
import assert from "node:assert/strict";
import {makeIntake} from "../service/intake.mjs";
import {createHttpHandler} from "../service/http.mjs";

const origin="https://vitium.echelonfoundry.com";
const keyV4="124e4567-e89b-42d3-a456-426614174000";
const valid=(patch={})=>({
  schemaVersion:"1.0",product:"Forma",impact:"Cannot use the feature",
  title:"Cannot save a change",actual:"Save does nothing.",
  expected:"Changes should be saved.",steps:"Open form.",pageUrl:"",
  privacyAcknowledged:true,...patch
});
// Deliberately uses the original duck-typed store contract so the test ran unchanged on baseline.
function memoryStore() {
  const records=new Map();
  return {records,async putOnce(item){
    if (records.has(item.pk)) return {created:false,existing:records.get(item.pk)};
    records.set(item.pk,item);return {created:true};
  }};
}
function fixture({verifyChallenge=async()=>true}={}) {
  const store=memoryStore();
  const service=makeIntake({store,verifyChallenge,now:()=>"2026-10-08T12:00:00.000Z",
    reference:()=>"VIT-00112233445566778899AABBCCDDEEFF"});
  return {store,handle:createHttpHandler(service)};
}
const event=(body,{key=keyV4,headers={}}={})=>({
  rawPath:"/api/v1/reports",requestContext:{http:{method:"POST"},requestId:"req-1"},
  headers:{origin,"content-type":"application/json","idempotency-key":key,...headers},
  body:JSON.stringify({...body,challengeToken:"challenge-token-example-123"})
});

test("D-01 VIT-API-005: every failure response carries a typed category and retry hint",async()=>{
  const categories=new Set(["validation","abuse","throttled","temporary","permanent","unavailable"]);
  const cases=[
    [fixture(),event(valid({actual:""}))],
    [fixture(),event(valid(),{headers:{origin:"https://attacker.example"}})],
    [fixture({verifyChallenge:async()=>false}),event(valid())],
    [fixture({verifyChallenge:async()=>{throw Error("down");}}),event(valid())]
  ];
  for (const [{handle},req] of cases) {
    const reply=await handle(req);
    const body=JSON.parse(reply.body);
    assert.ok(reply.statusCode>=400);
    assert.ok(categories.has(body.category),"missing category for "+body.code);
    assert.equal(typeof body.retryable,"boolean","missing retryable for "+body.code);
  }
});

test("D-02 challenge provider misconfiguration is a service outage, not the reporter's failure",async()=>{
  const {store,handle}=fixture({verifyChallenge:async()=>({ok:false,error:"misconfigured"})});
  const reply=await handle(event(valid()));
  const body=JSON.parse(reply.body);
  assert.equal(reply.statusCode,503);
  assert.equal(body.category,"unavailable");
  assert.equal(store.records.size,0);
});

test("D-03 VIT-AC-008: AWS keys, bearer tokens, PATs and URL passwords never reach storage verbatim",async()=>{
  const canaries=[
    "AKIAQXCANARY7EXAMPLE",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.c2lnbmF0dXJlY2FuYXJ5",
    "github_pat_11CANARY0000000000000000_abcdefghijklmnopqrstuvwxyz0123456789",
    "https://admin:Hunter2Canary@internal.example.com/x",
    "xoxb-123456789012-123456789012-canaryCANARYcanary"
  ];
  for (const canary of canaries) {
    const {store,handle}=fixture();
    const reply=await handle(event(valid({actual:"It failed after I used "+canary+" here."})));
    assert.ok(reply.statusCode<500,"unexpected outage");
    assert.ok(!reply.body.includes(canary));
    for (const record of store.records.values()) {
      assert.ok(!JSON.stringify(record).includes(canary),"stored verbatim: "+canary.slice(0,12));
    }
  }
});

test("D-04 C1 control characters (terminal CSI injection into operator console) are refused",async()=>{
  const {store,handle}=fixture();
  const reply=await handle(event(valid({actual:"Broken \u009b2J\u009b31m page"})));
  assert.equal(reply.statusCode,400);
  assert.equal(store.records.size,0);
});

test("D-05 time-based (v1) idempotency keys are refused; only random v4 keys are accepted",async()=>{
  const {store,handle}=fixture();
  const reply=await handle(event(valid(),{key:"124e4567-e89b-12d3-a456-426614174000"}));
  assert.equal(reply.statusCode,400);
  assert.equal(store.records.size,0);
});
