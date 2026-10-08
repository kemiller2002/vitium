// VIT-LCY-002 promotion through the operator CLI (service/triage-cli.mjs `promote`).
//
// EVIDENCE LABEL -- read before relying on these results:
//  * dynalite 4.0.0 does NOT implement TransactWriteItems. A real call returns
//    `UnknownOperationException` (HTTP 400); this was probed on 2026-10-08.
//  * These tests therefore run the CLI against `transactShim`, a TEST-ONLY client wrapper.
//    It executes each TransactItems entry as the equivalent single-item conditional
//    Update/Put against dynalite, so every ConditionExpression the CLI builds IS evaluated
//    by the emulator. It serialises transactions with an in-process mutex and undoes
//    already-applied items when a later item's condition fails.
//  * So this proves the CONDITIONS and the CLI's transaction plan and outcome handling.
//    It is NOT evidence of DynamoDB transaction atomicity, isolation or cross-process
//    behaviour. That needs a real-DynamoDB staging run (blocker R-01).
import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";
import {DynamoDBClient, CreateTableCommand, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand,
  DeleteItemCommand, ScanCommand, TransactWriteItemsCommand} from "@aws-sdk/client-dynamodb";
import {runTriage, planPromotion} from "../../service/triage-cli.mjs";
import {table as lifecycleTable} from "../../service/triage.mjs";
import {evaluateTransition} from "../../service/lifecycle.mjs";

let server, client, idSeq = 0;
const TABLE = "vitium-promote-it";
before(async () => {
  server = dynalite({createTableMs:0});
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", e => e ? reject(e) : resolve()));
  client = new DynamoDBClient({endpoint:"http://127.0.0.1:" + server.address().port, region:"us-east-1",
    credentials:{accessKeyId:"emulator", secretAccessKey:"emulator"}, maxAttempts:1});
  await client.send(new CreateTableCommand({TableName:TABLE, BillingMode:"PAY_PER_REQUEST",
    AttributeDefinitions:[{AttributeName:"pk", AttributeType:"S"}], KeySchema:[{AttributeName:"pk", KeyType:"HASH"}]}));
});
after(async () => { client?.destroy(); await new Promise(r => server.close(r)); });

/** TEST-ONLY transaction shim (see header). Counts every write the CLI issues. */
function transactShim() {
  let lock = Promise.resolve();
  const calls = [];
  const getItem = async (TableName, Key) => (await client.send(new GetItemCommand({TableName, Key, ConsistentRead:true}))).Item;
  const runTx = async input => {
    const undo = [];
    for (const [i, entry] of input.TransactItems.entries()) {
      const op = entry.Update ? "Update" : entry.Put ? "Put" : null;
      if (!op) throw Object.assign(new Error("shim supports Update/Put only"), {name:"ValidationException"});
      const spec = entry[op];
      const Key = op === "Update" ? spec.Key : {pk:spec.Item.pk};
      const before = await getItem(spec.TableName, Key);
      try {
        await client.send(op === "Update" ? new UpdateItemCommand(spec) : new PutItemCommand(spec));
        undo.push({TableName:spec.TableName, Key, before});
      } catch (error) {
        for (const u of undo.reverse()) {
          await client.send(u.before ? new PutItemCommand({TableName:u.TableName, Item:u.before}) : new DeleteItemCommand({TableName:u.TableName, Key:u.Key}));
        }
        if (error?.name === "ConditionalCheckFailedException") {
          throw Object.assign(new Error("Transaction cancelled"), {name:"TransactionCanceledException",
            CancellationReasons:input.TransactItems.map((_, j) => ({Code:j === i ? "ConditionalCheckFailed" : "None"}))});
        }
        throw error;
      }
    }
    return {};
  };
  return {calls, async send(cmd) {
    calls.push(cmd.constructor.name);
    if (cmd instanceof TransactWriteItemsCommand) {
      const next = lock.then(() => runTx(cmd.input));
      lock = next.catch(() => {});
      return next;
    }
    return client.send(cmd);
  }};
}

const commands = {GetItemCommand, QueryCommand, UpdateItemCommand, TransactWriteItemsCommand};
const DEV = "arn:aws:iam::000000000000:user/developer";
const QA = "arn:aws:iam::000000000000:user/verifier";
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 8, 14, 0, clock++)).toISOString();
const freshId = () => "DEF-" + String(9000000000000000 + (++idSeq));
async function cli(argv, {actor = DEV, db = transactShim(), newDefectId = freshId} = {}) {
  const out = [], err = [];
  const code = await runTriage({argv, table:TABLE, db, commands, identity:async () => actor, now, newDefectId,
    out:t => out.push(t), err:t => err.push(t)});
  return {code, out:out.join(""), err:err.join("")};
}
const show = async key => JSON.parse((await cli(["show", "--key=" + key])).out);
const defects = async () => ((await client.send(new ScanCommand({TableName:TABLE, ConsistentRead:true}))).Items ?? [])
  .filter(i => i.kind?.S === "defect");

let obsSeq = 0;
/** Seed an observation in the given state with a lifecycle-consistent history. */
async function seedObservation(state) {
  const key = "REQUEST#" + String(++obsSeq).padStart(64, "0");
  const base = {actor:DEV, provenance:"authenticated-human", role:"triager", reason:"seed", occurredAt:"2026-10-08T12:00:00.000Z"};
  let record = {kind:"observation", state:"received", revision:0, history:[]};
  const path = {received:[], "accepted-for-triage":["accepted-for-triage"], classified:["accepted-for-triage", "classified"]}[state];
  for (const to of path) {
    const r = evaluateTransition(lifecycleTable, record, {...base, to, expectedRevision:record.revision,
      fields:to === "classified" ? {classification:"ui-defect"} : {}});
    assert.equal(r.ok, true, JSON.stringify(r.error));
    record = r.value.record;
  }
  await client.send(new PutItemCommand({TableName:TABLE, Item:{
    pk:{S:key}, reference:{S:"VIT-" + "A".repeat(32)}, kind:{S:"observation"}, state:{S:record.state},
    revision:{N:String(record.revision)}, history:{S:JSON.stringify(record.history)},
    report:{S:JSON.stringify({title:"Save fails"})}, receivedAt:{S:"2026-10-08T11:00:00.000Z"}
  }}));
  return key;
}

test("I-30 promote: NEW defect exists, observation links to it, observation kind/state unchanged; ONE transaction", async () => {
  const key = await seedObservation("classified");
  const db = transactShim();
  const r = await cli(["promote", "--key=" + key, "--reason=confirmed user-facing defect"], {db});
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(db.calls.filter(c => c !== "GetItemCommand"), ["TransactWriteItemsCommand"], "exactly one transactional write, no loose writes");
  const {defect} = JSON.parse(r.out);
  const def = await show(defect);
  assert.equal(def.kind, "defect");
  assert.equal(def.state, "new");
  assert.equal(def.revision, 0);
  assert.deepEqual(def.observationKeys, [key]);
  assert.equal(def.history[0].type, "created");
  const obs = await show(key);
  assert.equal(obs.kind, "observation", "never mutated into a defect");
  assert.equal(obs.state, "classified");
  assert.equal(obs.promotedTo, defect.slice("DEFECT#".length));
  assert.deepEqual(obs.links.defectIds, [defect.slice("DEFECT#".length)]);
  assert.equal(obs.history.at(-1).type, "promoted");
  assert.equal(obs.history.at(-1).provenance, "authenticated-human");
  assert.equal(obs.revision, 3);
  assert.match(defect, /^DEFECT#DEF-[1-9][0-9]{15}$/);
});

test("I-31 double promote and concurrent promote each yield exactly one defect", async () => {
  const k1 = await seedObservation("classified");
  const before1 = (await defects()).length;
  assert.equal((await cli(["promote", "--key=" + k1, "--reason=a"])).code, 0);
  const again = await cli(["promote", "--key=" + k1, "--reason=b"]);
  assert.equal(again.code, 5);
  assert.match(again.err, /already_promoted/);
  assert.equal((await defects()).length, before1 + 1);

  const k2 = await seedObservation("classified");
  const before2 = (await defects()).length;
  const shared = transactShim();
  const results = await Promise.all(Array.from({length:5}, (_, i) => cli(["promote", "--key=" + k2, "--reason=race " + i], {db:shared})));
  const codes = results.map(r => r.code).sort();
  assert.deepEqual(codes, [0, 6, 6, 6, 6], results.map(r => r.err).join("|"));
  assert.equal((await defects()).length, before2 + 1, "exactly one defect for the observation");
  const obs = await show(k2);
  assert.equal(obs.links.defectIds.length, 1);
  assert.equal(obs.history.filter(e => e.type === "promoted").length, 1);
});

test("I-32 unclassified observations are refused; local refusals make no AWS call", async () => {
  for (const state of ["received", "accepted-for-triage"]) {
    const key = await seedObservation(state);
    const before = (await defects()).length;
    const r = await cli(["promote", "--key=" + key, "--reason=x"]);
    assert.equal(r.code, 5, state);
    assert.match(r.err, /forbidden_transition/);
    assert.equal((await defects()).length, before);
    assert.equal((await show(key)).promotedTo, undefined);
  }
  const noAws = {async send() { throw new Error("AWS must not be called"); }};
  for (const argv of [
    ["promote", "--key=REQUEST#" + "1".repeat(64)],                              // no reason
    ["promote", "--key=REQUEST#" + "1".repeat(64), "--reason=x", "--role=verifier"], // role not in promotion.roles
    ["promote", "--key=DEFECT#DEF-1234", "--reason=x"]                              // defects are not promotable
  ]) {
    let ids = 0;
    const code = await runTriage({argv, table:TABLE, db:noAws, commands, identity:async () => { ids++; return DEV; }, now,
      newDefectId:freshId, out:() => {}, err:() => {}});
    assert.equal(code, 2, argv.join(" "));
    assert.equal(ids, 0);
  }
});

test("I-33 defect-id collision: the whole transaction is cancelled and the observation is untouched", async () => {
  const existing = await seedObservation("classified");
  const first = JSON.parse((await cli(["promote", "--key=" + existing, "--reason=a"])).out).defect.slice("DEFECT#".length);
  const key = await seedObservation("classified");
  const before = await show(key);
  const r = await cli(["promote", "--key=" + key, "--reason=b"], {newDefectId:() => first});
  assert.equal(r.code, 6, r.err);
  const after = await show(key);
  assert.equal(after.revision, before.revision);
  assert.equal(after.promotedTo, undefined);
  assert.deepEqual((await show("DEFECT#" + first)).observationKeys, [existing], "existing defect not overwritten");
  // Retrying (a fresh random id) succeeds.
  assert.equal((await cli(["promote", "--key=" + key, "--reason=b"])).code, 0);
});

test("I-34 the promoted defect runs the full verification cycle (two failures, then independent pass)", async () => {
  const key = await seedObservation("classified");
  const defect = JSON.parse((await cli(["promote", "--key=" + key, "--reason=promote"])).out).defect;
  const step = async (argv, actor = DEV) => { const r = await cli(argv, {actor}); assert.equal(r.code, 0, argv.join(" ") + " :: " + r.err); };
  await step(["advance", "--key=" + defect, "--to=triaged", "--reason=triage", "--severity=high"]);
  await step(["advance", "--key=" + defect, "--to=confirmed", "--reason=reproduced", "--evidence=reproduction:REPRO-1"]);
  await step(["advance", "--key=" + defect, "--to=in-progress", "--reason=start", "--workItemRef=WI-1"]);
  for (const [attempt, outcome] of [["P1", "failed"], ["P2", "failed"], ["P3", "passed"]]) {
    await step(["advance", "--key=" + defect, "--to=awaiting-verification", "--attempt=" + attempt, "--candidate=rev-" + attempt,
      "--evidence=verification-request:REQ-" + attempt, "--reason=submit"]);
    await step(["verify", "--key=" + defect, "--attempt=" + attempt, "--candidate=rev-" + attempt, "--outcome=" + outcome,
      "--evidence=verification-run:RUN-" + attempt, "--reason=" + outcome], QA);
  }
  const final = await show(defect);
  assert.equal(final.state, "resolved");
  assert.deepEqual(final.history.map(e => e.fields?.verificationOutcome).filter(Boolean), ["failed", "failed", "passed"]);
  assert.equal(final.history[0].type, "created");
  assert.equal((await show(key)).state, "classified", "observation unaffected by defect lifecycle");
});

test("I-35 planPromotion is pure and carries both conditions", () => {
  const plan = planPromotion({table:"t", key:"REQUEST#k", record:{revision:2},
    result:{observation:{revision:3, history:[], links:{defectIds:["DEF-1000000000000001"]}},
      defect:{id:"DEF-1000000000000001", state:"new", revision:0, history:[]}}, createdAt:"2026-10-08T00:00:00.000Z"});
  assert.equal(plan.TransactItems.length, 2);
  const [u, p] = plan.TransactItems;
  assert.match(u.Update.ConditionExpression, /#state = :classified/);
  assert.match(u.Update.ConditionExpression, /revision = :expected/);
  assert.match(u.Update.ConditionExpression, /attribute_not_exists\(promotedTo\)/);
  assert.equal(u.Update.ExpressionAttributeValues[":expected"].N, "2");
  assert.doesNotMatch(u.Update.UpdateExpression, /#state =|#kind =/, "observation state/kind never rewritten");
  assert.equal(p.Put.ConditionExpression, "attribute_not_exists(pk)");
  assert.equal(p.Put.Item.pk.S, "DEFECT#DEF-1000000000000001");
});
