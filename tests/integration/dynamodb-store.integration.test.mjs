// EMULATOR EVIDENCE, NOT AWS EVIDENCE.
// Runs the production DynamoDB store adapter (service/adapters/dynamodb-store.mjs) and the
// full Lambda composition (service/aws-handler.mjs composeHandler) through the real AWS SDK
// v3 wire protocol against dynalite, a local DynamoDB emulator that implements
// ConditionExpression and ConsistentRead. A real-DynamoDB staging test remains a release
// blocker (VIT-AC-006); dynalite serialises writes in-process and cannot reproduce AWS
// partition behaviour, throttling, or regional failover.
//
// Run: npm run test:integration   (no network beyond 127.0.0.1)
import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";
import {
  DynamoDBClient, CreateTableCommand, PutItemCommand, GetItemCommand, ScanCommand
} from "@aws-sdk/client-dynamodb";
import {makeDynamoStore} from "../../service/adapters/dynamodb-store.mjs";
import {composeHandler} from "../../service/aws-handler.mjs";
import {makeIntake} from "../../service/intake.mjs";

const commands = {PutItemCommand, GetItemCommand};
let server, client, tableSeq = 0;

before(async () => {
  server = dynalite({createTableMs:0, deleteTableMs:0, updateTableMs:0});
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", err => err ? reject(err) : resolve()));
  client = new DynamoDBClient({
    endpoint:"http://127.0.0.1:" + server.address().port, region:"us-east-1",
    credentials:{accessKeyId:"emulator", secretAccessKey:"emulator"}, maxAttempts:1
  });
});
after(async () => { client?.destroy(); await new Promise(r => server.close(r)); });

/** Same key schema and GSI as infra/aws/template.yaml ReportsTable. */
async function freshTable() {
  const TableName = "vitium-it-" + (++tableSeq);
  await client.send(new CreateTableCommand({
    TableName, BillingMode:"PAY_PER_REQUEST",
    AttributeDefinitions:[
      {AttributeName:"pk", AttributeType:"S"},
      {AttributeName:"reviewQueuePk", AttributeType:"S"},
      {AttributeName:"reviewQueueSk", AttributeType:"S"}
    ],
    KeySchema:[{AttributeName:"pk", KeyType:"HASH"}],
    GlobalSecondaryIndexes:[{IndexName:"ReviewQueue",
      KeySchema:[{AttributeName:"reviewQueuePk", KeyType:"HASH"}, {AttributeName:"reviewQueueSk", KeyType:"RANGE"}],
      Projection:{ProjectionType:"KEYS_ONLY"}}]
  }));
  return TableName;
}
const allItems = async TableName => (await client.send(new ScanCommand({TableName, ConsistentRead:true}))).Items ?? [];

const origin = "https://vitium.echelonfoundry.com";
const config = Object.freeze({tableName:"", secretArn:"arn:aws:secretsmanager:us-east-1:000000000000:secret:emulator",
  allowedOrigin:origin, expectedHostname:"vitium.echelonfoundry.com"});
const report = (patch = {}) => ({schemaVersion:"1.0", product:"Forma", impact:"Not sure",
  title:"Save fails", actual:"Nothing happens.", expected:"It saves.", steps:"", pageUrl:"",
  privacyAcknowledged:true, ...patch});
let tokenSeq = 0;
const event = (key, body = report()) => ({
  rawPath:"/api/v1/reports", requestContext:{http:{method:"POST"}, requestId:"it-" + tokenSeq},
  headers:{origin, "content-type":"application/json", "idempotency-key":key},
  body:JSON.stringify({...body, challengeToken:"emulator-challenge-" + (++tokenSeq)})
});
// Turnstile is replaced by an injected fetch (no network); the DynamoDB path is real SDK + emulator.
const fakeTurnstile = async () => ({ok:true, json:async () => ({success:true, hostname:"vitium.echelonfoundry.com", action:"vitium-intake"})});
const liveLikeHandler = (tableName, dynamo = client, log = () => {}) => composeHandler({
  config:{...config, tableName}, dynamo, commands, loadSecret:async () => "emulator-secret", fetch:fakeTurnstile, log
});
/** Client wrapper that injects faults around the real client. */
function faultyClient(plan) {
  let call = 0;
  return {async send(command) {
    const step = plan(++call, command);
    if (step === "fail-before") throw Object.assign(new Error("socket hang up"), {name:"TimeoutError"});
    if (step === "throttle") throw Object.assign(new Error("slow down"), {name:"ThrottlingException"});
    const result = await client.send(command);
    if (step === "fail-after") throw Object.assign(new Error("response lost"), {name:"TimeoutError"});
    return result;
  }};
}

test("I-01 50 concurrent identical deliveries through the full handler -> exactly one durable record", async () => {
  const table = await freshTable();
  const handle = liveLikeHandler(table);
  const key = crypto.randomUUID();
  const replies = await Promise.all(Array.from({length:50}, () => handle(event(key))));
  const statuses = replies.map(r => r.statusCode);
  assert.equal(statuses.filter(s => s === 201).length, 1, "exactly one create: " + statuses.join(","));
  assert.equal(statuses.filter(s => s === 200).length, 49);
  assert.equal(new Set(replies.map(r => JSON.parse(r.body).reference)).size, 1);
  const items = await allItems(table);
  assert.equal(items.length, 1);
  assert.equal(items[0].reference.S, JSON.parse(replies[0].body).reference);
});

test("I-02 50 concurrent deliveries mixing two bodies under one key -> one record, others conflict or replay", async () => {
  const table = await freshTable();
  const handle = liveLikeHandler(table);
  const key = crypto.randomUUID();
  const replies = await Promise.all(Array.from({length:50}, (_, i) =>
    handle(event(key, report({title: i % 2 ? "Body B" : "Body A"})))));
  const items = await allItems(table);
  assert.equal(items.length, 1);
  const winner = JSON.parse(items[0].report.S).title;
  const codes = replies.map((r, i) => [i % 2 ? "Body B" : "Body A", r.statusCode, JSON.parse(r.body)]);
  for (const [title, status, body] of codes) {
    if (title === winner) assert.ok(status === 201 || status === 200, "winner body must succeed");
    else {
      assert.equal(status, 409);
      assert.equal(body.code, "request_conflict");
      assert.equal(body.reference, undefined, "conflict must not reveal the stored reference");
    }
  }
  assert.equal(codes.filter(([, s]) => s === 201).length, 1);
});

test("I-03 50 concurrent distinct keys -> 50 records, 50 distinct references", async () => {
  const table = await freshTable();
  const handle = liveLikeHandler(table);
  const replies = await Promise.all(Array.from({length:50}, () => handle(event(crypto.randomUUID()))));
  assert.ok(replies.every(r => r.statusCode === 201));
  assert.equal(new Set(replies.map(r => JSON.parse(r.body).reference)).size, 50);
  assert.equal((await allItems(table)).length, 50);
});

test("I-04 transient failure before write -> typed 503, nothing stored, retry creates once", async () => {
  const table = await freshTable();
  const key = crypto.randomUUID();
  const broken = liveLikeHandler(table, faultyClient(() => "fail-before"));
  const first = await broken(event(key));
  assert.equal(first.statusCode, 503);
  assert.equal(JSON.parse(first.body).code, "storage_unavailable");
  assert.equal(JSON.parse(first.body).reference, undefined);
  assert.equal((await allItems(table)).length, 0);
  const retry = await liveLikeHandler(table)(event(key));
  assert.equal(retry.statusCode, 201);
  assert.equal((await allItems(table)).length, 1);
});

test("I-05 write commits but response is lost -> no receipt; client retry replays the ORIGINAL reference", async () => {
  const table = await freshTable();
  const key = crypto.randomUUID();
  const lossy = liveLikeHandler(table, faultyClient(n => n === 1 ? "fail-after" : "pass"));
  const first = await lossy(event(key));
  assert.equal(first.statusCode, 503, "a lost acknowledgement must not become a receipt");
  const items = await allItems(table);
  assert.equal(items.length, 1, "the write itself did commit");
  const retry = await liveLikeHandler(table)(event(key));
  assert.equal(retry.statusCode, 200);
  assert.equal(JSON.parse(retry.body).replayed, true);
  assert.equal(JSON.parse(retry.body).reference, items[0].reference.S);
});

test("I-06 conditional failure followed by a failing replay read -> typed 503, never a receipt", async () => {
  const table = await freshTable();
  const key = crypto.randomUUID();
  await liveLikeHandler(table)(event(key));
  const readBroken = liveLikeHandler(table, faultyClient((n, cmd) => cmd instanceof GetItemCommand ? "fail-before" : "pass"));
  const reply = await readBroken(event(key));
  assert.equal(reply.statusCode, 503);
  assert.equal(JSON.parse(reply.body).reference, undefined);
  const throttled = liveLikeHandler(table, faultyClient(() => "throttle"));
  const t = await throttled(event(crypto.randomUUID()));
  assert.equal(t.statusCode, 429);
  assert.equal(JSON.parse(t.body).category, "throttled");
  assert.equal((await allItems(table)).length, 1);
});

test("I-07 replay read projects only receipt attributes, never the report body", async () => {
  const table = await freshTable();
  const seen = [];
  const spy = {async send(command) { seen.push(command); return client.send(command); }};
  const store = makeDynamoStore({client:spy, tableName:table, commands});
  const intake = makeIntake({store, verifyChallenge:async () => ({ok:true, value:true})});
  const key = crypto.randomUUID();
  await intake.submit({...report(), challengeToken:"emulator-challenge-x1"}, {idempotencyKey:key, challengeToken:"emulator-challenge-x1"});
  const replay = await intake.submit({...report(), challengeToken:"emulator-challenge-x2"}, {idempotencyKey:key, challengeToken:"emulator-challenge-x2"});
  assert.equal(replay.ok, true);
  const get = seen.find(c => c instanceof GetItemCommand);
  assert.ok(get, "replay must use GetItem");
  assert.equal(get.input.ConsistentRead, true);
  assert.deepEqual(Object.values(get.input.ExpressionAttributeNames).sort(), ["disposition", "payloadHash", "receivedAt", "reference"]);
  const put = seen.find(c => c instanceof PutItemCommand);
  assert.equal(put.input.ConditionExpression, "attribute_not_exists(pk)");
  assert.ok(!JSON.stringify(put.input).includes("emulator-challenge"), "challenge token must not be persisted");
});

test("I-08 quarantined observations land in the quarantine queue partition with redacted text", async () => {
  const table = await freshTable();
  const key = crypto.randomUUID();
  const reply = await liveLikeHandler(table)(event(key, report({actual:"token ghp_EMULATORcanary0123456789abcdefXYZ broke it"})));
  assert.equal(reply.statusCode, 201);
  assert.equal(JSON.parse(reply.body).disposition, "quarantined");
  const [item] = await allItems(table);
  assert.equal(item.reviewQueuePk.S, "QUEUE#quarantined");
  assert.equal(item.state.S, "quarantined");
  assert.ok(!item.report.S.includes("ghp_EMULATOR"));
  assert.equal(item.visibility.S, "private");
});
