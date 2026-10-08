// EMULATOR EVIDENCE, NOT AWS EVIDENCE: service/triage-cli.mjs runTriage against dynalite.
// IAM privilege boundaries cannot be exercised by an emulator (dynalite does not enforce IAM).
import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";
import {DynamoDBClient, CreateTableCommand, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand} from "@aws-sdk/client-dynamodb";
import {runTriage} from "../../service/triage-cli.mjs";
import {makeDynamoStore} from "../../service/adapters/dynamodb-store.mjs";
import {makeIntake} from "../../service/intake.mjs";
import {assertIdempotencyKey} from "../../service/report-domain.mjs";

let server, client;
const TABLE = "vitium-triage-it";
before(async () => {
  server = dynalite({createTableMs:0});
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", e => e ? reject(e) : resolve()));
  client = new DynamoDBClient({endpoint:"http://127.0.0.1:" + server.address().port, region:"us-east-1",
    credentials:{accessKeyId:"emulator", secretAccessKey:"emulator"}, maxAttempts:1});
  await client.send(new CreateTableCommand({TableName:TABLE, BillingMode:"PAY_PER_REQUEST",
    AttributeDefinitions:[{AttributeName:"pk",AttributeType:"S"},{AttributeName:"reviewQueuePk",AttributeType:"S"},{AttributeName:"reviewQueueSk",AttributeType:"S"}],
    KeySchema:[{AttributeName:"pk",KeyType:"HASH"}],
    GlobalSecondaryIndexes:[{IndexName:"ReviewQueue",KeySchema:[{AttributeName:"reviewQueuePk",KeyType:"HASH"},{AttributeName:"reviewQueueSk",KeyType:"RANGE"}],Projection:{ProjectionType:"KEYS_ONLY"}}]}));
});
after(async () => { client?.destroy(); await new Promise(r => server.close(r)); });

const commands = {GetItemCommand, QueryCommand, UpdateItemCommand};
async function cli(argv, actor = "arn:aws:iam::000000000000:user/emulator-operator") {
  const out = [], err = [];
  const code = await runTriage({argv, table:TABLE, db:client, commands, identity:async () => actor,
    now:() => "2026-10-08T13:00:00.000Z", out:t => out.push(t), err:t => err.push(t)});
  return {code, out:out.join(""), err:err.join("")};
}
async function submit(actual) {
  const key = crypto.randomUUID();
  const intake = makeIntake({store:makeDynamoStore({client, tableName:TABLE, commands:{PutItemCommand, GetItemCommand}}),
    verifyChallenge:async () => ({ok:true, value:true})});
  const r = await intake.submit({schemaVersion:"1.0", product:"Forma", impact:"Not sure", title:"t", actual,
    expected:"e", steps:"", pageUrl:"", privacyAcknowledged:true}, {idempotencyKey:key, challengeToken:"emulator-challenge-001"});
  assert.equal(r.ok, true);
  return "REQUEST#" + assertIdempotencyKey(key);
}

test("I-09 queues separate pending and quarantined; queue listing never prints report text", async () => {
  const pendingKey = await submit("Plain text BODYMARKER");
  const quarantinedKey = await submit("I found an XSS vulnerability BODYMARKER");
  const pending = await cli(["queue"]);
  const quarantined = await cli(["queue", "--queue=quarantined"]);
  assert.equal(pending.code, 0);
  assert.deepEqual(JSON.parse(pending.out).pendingKeys, [pendingKey]);
  assert.deepEqual(JSON.parse(quarantined.out).pendingKeys, [quarantinedKey]);
  assert.ok(!pending.out.includes("BODYMARKER") && !quarantined.out.includes("BODYMARKER"));
});

test("I-10 advancing quarantined -> accepted-for-triage moves it to the pending queue; terminal leaves both", async () => {
  const key = await submit("Possible exploit in upload");
  let r = await cli(["advance", "--key=" + key, "--to=accepted-for-triage", "--reason=reviewed, no secret"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(JSON.parse((await cli(["queue"])).out).pendingKeys.includes(key));
  assert.ok(!JSON.parse((await cli(["queue", "--queue=quarantined"])).out).pendingKeys.includes(key));
  r = await cli(["advance", "--key=" + key, "--to=rejected", "--reason=not a defect"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(!JSON.parse((await cli(["queue"])).out).pendingKeys.includes(key));
  const shown = JSON.parse((await cli(["show", "--key=" + key])).out);
  assert.equal(shown.state, "rejected");
  assert.equal(shown.revision, 2);
  assert.equal(shown.history[0].actor, "arn:aws:iam::000000000000:user/emulator-operator");
});

test("I-11 stale concurrent advance is refused by the conditional update, not silently applied", async () => {
  const key = await submit("Race me");
  const [a, b] = await Promise.all([
    cli(["advance", "--key=" + key, "--to=accepted-for-triage", "--reason=a"]),
    cli(["advance", "--key=" + key, "--to=rejected", "--reason=b"])
  ]);
  const codes = [a.code, b.code].sort();
  assert.deepEqual(codes, [0, 6], a.err + b.err);
  assert.equal(JSON.parse((await cli(["show", "--key=" + key])).out).revision, 1);
});

test("I-12 illegal transitions and malformed keys exit non-zero without stack traces", async () => {
  const key = await submit("x");
  const illegal = await cli(["advance", "--key=" + key, "--to=classified", "--reason=skip"]);
  assert.equal(illegal.code, 5);
  assert.ok(!/at .*\.mjs/.test(illegal.err));
  assert.equal((await cli(["show", "--key=REQUEST#nothex"])).code, 2);
  assert.equal((await cli(["show", "--key=REQUEST#" + "0".repeat(64)])).code, 4);
  assert.equal((await cli(["show", "--key=" + key], "")).code, 3);
});
