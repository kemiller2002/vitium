// EMULATOR EVIDENCE, NOT AWS EVIDENCE: the operator CLI (service/triage-cli.mjs runTriage)
// drives the table 1.2.0 verification cycle (VIT-LCY-010/011, VIT-VER-009/010,
// VIT-AC-033/034/036) through the STRICT lifecycle path against dynalite.
import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";
import {DynamoDBClient, CreateTableCommand, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand} from "@aws-sdk/client-dynamodb";
import {runTriage, planUpdate} from "../../service/triage-cli.mjs";
import {table as lifecycleTable} from "../../service/triage.mjs";
import {evaluateTransition} from "../../service/lifecycle.mjs";

let server, client, seq = 1000;
const TABLE = "vitium-cycle-it";
before(async () => {
  server = dynalite({createTableMs:0});
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", e => e ? reject(e) : resolve()));
  client = new DynamoDBClient({endpoint:"http://127.0.0.1:" + server.address().port, region:"us-east-1",
    credentials:{accessKeyId:"emulator", secretAccessKey:"emulator"}, maxAttempts:1});
  await client.send(new CreateTableCommand({TableName:TABLE, BillingMode:"PAY_PER_REQUEST",
    AttributeDefinitions:[{AttributeName:"pk", AttributeType:"S"}], KeySchema:[{AttributeName:"pk", KeyType:"HASH"}]}));
});
after(async () => { client?.destroy(); await new Promise(r => server.close(r)); });

const commands = {GetItemCommand, QueryCommand, UpdateItemCommand};
// VF-035: humans are assumed-role sessions of allow-listed roles; anything else is an agent.
const DEV = "arn:aws:sts::000000000000:assumed-role/TriageOperator/developer";
const QA = "arn:aws:sts::000000000000:assumed-role/VerifierOperator/verifier";
const HUMAN_ROLES = "arn:aws:iam::000000000000:role/vitium/TriageOperator,arn:aws:iam::000000000000:role/VerifierOperator";
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 8, 13, 0, clock++)).toISOString();
async function cli(argv, actor = DEV, db = client) {
  const out = [], err = [];
  const code = await runTriage({argv, table:TABLE, db, commands, identity:async () => actor, now, humanOperatorRoles:HUMAN_ROLES, out:t => out.push(t), err:t => err.push(t)});
  return {code, out:out.join(""), err:err.join("")};
}
const show = async key => JSON.parse((await cli(["show", "--key=" + key])).out);

/** Seed a confirmed defect, already moved to in-progress, via the pure domain functions. */
async function seedInProgressDefect() {
  const id = "DEF-" + (++seq);
  const base = {actor:DEV, provenance:"authenticated-human", role:"triager", reason:"seed", occurredAt:"2026-10-08T12:00:00.000Z"};
  let record = {kind:"defect", id, state:"confirmed", revision:0, history:[]};
  const r = evaluateTransition(lifecycleTable, record, {...base, to:"in-progress", expectedRevision:0});
  assert.equal(r.ok, true, JSON.stringify(r.error));
  record = r.value.record;
  await client.send(new PutItemCommand({TableName:TABLE, Item:{
    pk:{S:"DEFECT#" + id}, id:{S:id}, kind:{S:"defect"}, state:{S:record.state},
    revision:{N:String(record.revision)}, history:{S:JSON.stringify(record.history)}
  }, ConditionExpression:"attribute_not_exists(pk)"}));
  return "DEFECT#" + id;
}
const submit = (key, attempt, candidate) => cli(["advance", "--key=" + key, "--to=awaiting-verification",
  "--attempt=" + attempt, "--candidate=" + candidate, "--work-item=WI-7", "--evidence=verification-request:REQ-" + attempt, "--reason=submit " + attempt]);
const verify = (key, attempt, candidate, outcome, actor = QA) => cli(["verify", "--key=" + key, "--attempt=" + attempt,
  "--candidate=" + candidate, "--outcome=" + outcome, "--evidence=verification-run:RUN-" + attempt + "-" + outcome, "--reason=" + outcome], actor);

test("I-20 full cycle: two failed iterations, an inconclusive run, then an independent pass (append-only)", async () => {
  const key = await seedInProgressDefect();
  // Iteration 1: submit, fail -> back to in-progress.
  assert.equal((await submit(key, "A1", "rev-1")).code, 0);
  let r = await verify(key, "A1", "rev-1", "failed");
  assert.equal(r.code, 0, r.err);
  assert.equal((await show(key)).state, "in-progress");
  // Iteration 2: a result must name the LATEST submission; a stale attempt is refused by the domain.
  assert.equal((await submit(key, "A2", "rev-2")).code, 0);
  r = await verify(key, "A1", "rev-1", "failed");
  assert.equal(r.code, 5);
  assert.match(r.err, /attempt_mismatch/);
  r = await verify(key, "A2", "rev-2", "inconclusive");
  assert.equal(r.code, 0, r.err);
  assert.equal((await show(key)).state, "awaiting-verification", "inconclusive is an event, not a transition");
  assert.equal((await verify(key, "A2", "rev-2", "failed")).code, 0);
  // A reused attemptId is refused.
  r = await submit(key, "A2", "rev-3");
  assert.equal(r.code, 5);
  assert.match(r.err, /duplicate_attempt/);
  // Iteration 3: the author cannot pass their own attempt; an independent verifier can.
  assert.equal((await submit(key, "A3", "rev-3")).code, 0);
  r = await verify(key, "A3", "rev-3", "passed", DEV);
  assert.equal(r.code, 5);
  assert.match(r.err, /independence_required/);
  r = await verify(key, "A3", "rev-3", "passed");
  assert.equal(r.code, 0, r.err);
  const final = await show(key);
  assert.equal(final.state, "resolved");
  const outcomes = final.history.map(e => e.fields?.verificationOutcome).filter(Boolean);
  assert.deepEqual(outcomes, ["failed", "inconclusive", "failed", "passed"]);
  const submissions = final.history.filter(e => e.to === "awaiting-verification");
  assert.deepEqual(submissions.map(e => [e.fields.attemptId, e.fields.candidateRevision, e.fields.author]),
    [["A1", "rev-1", DEV], ["A2", "rev-2", DEV], ["A3", "rev-3", DEV]]);
  assert.ok(final.history.every(e => e.provenance === "authenticated-human"), "strict path: never 'unrecorded'");
  assert.ok(final.history.every(e => e.legacyEvidence === undefined && e.evidenceId === undefined), "no legacy evidenceId shape");
  assert.deepEqual(final.history.map(e => e.sequence), final.history.map((_, i) => i + 1));
});

test("I-21 resolved -> reopen-and-resume: both events in ONE conditional write; a concurrent stale writer is refused", async () => {
  const key = await seedInProgressDefect();
  await submit(key, "B1", "rev-1");
  assert.equal((await verify(key, "B1", "rev-1", "passed")).code, 0);
  const resolved = await show(key);
  assert.equal(resolved.state, "resolved");

  // Spy on writes: the composite must issue exactly one UpdateItem carrying both events.
  const writes = [];
  const spy = {async send(cmd) { if (cmd instanceof UpdateItemCommand) writes.push(cmd.input); return client.send(cmd); }};
  const r = await cli(["reopen-and-resume", "--key=" + key, "--evidence=new-occurrence:OBS-REGRESSION-1",
    "--affected-release=2.4.0", "--attempt=B2", "--work-item=WI-8", "--reason=regressed in 2.4.0", "--resume-reason=new work attempt"], DEV, spy);
  assert.equal(r.code, 0, r.err);
  assert.equal(writes.length, 1, "exactly one conditional write for the composite");
  assert.match(writes[0].ConditionExpression, /revision = :expected AND #state = :before/);
  assert.equal(writes[0].ExpressionAttributeValues[":expected"].N, String(resolved.revision));
  assert.equal(writes[0].ExpressionAttributeValues[":version"].N, String(resolved.revision + 2));
  const after = await show(key);
  assert.equal(after.state, "in-progress");
  const [reopen, resume] = after.history.slice(-2);
  assert.equal(reopen.to, "reopened");
  assert.equal(reopen.fields.affectedRelease, "2.4.0");
  assert.equal(reopen.reopens.state, "resolved", "reopen points at the overridden resolution");
  assert.equal(resume.from, "reopened");
  assert.equal(resume.fields.attemptId, "B2");
  assert.ok(after.history.some(e => e.fields?.verificationOutcome === "passed"), "earlier passing evidence preserved");

  // Concurrent stale writer: both read the same resolved revision; only one may win.
  const key2 = await seedInProgressDefect();
  await submit(key2, "C1", "rev-1");
  await verify(key2, "C1", "rev-1", "passed");
  const [a, b] = await Promise.all([
    cli(["reopen-and-resume", "--key=" + key2, "--evidence=new-occurrence:OBS-X", "--attempt=C2", "--work-item=WI-9", "--reason=a"]),
    cli(["advance", "--key=" + key2, "--to=closed", "--evidence=verification-run:RUN-C1", "--reason=b"])
  ]);
  assert.deepEqual([a.code, b.code].sort(), [0, 6], a.err + b.err);
  const winner = await show(key2);
  assert.ok(["in-progress", "closed"].includes(winner.state), "never left in the intermediate reopened state: " + winner.state);
  assert.equal(winner.history.length, winner.revision, "history and revision written together");
  if (winner.state === "closed") assert.ok(!winner.history.some(e => e.to === "reopened"), "loser's composite left no partial event");
});

test("I-22 local refusals happen before any AWS call (missing fields/evidence/role per the table)", async () => {
  const noAws = {async send() { throw new Error("AWS must not be called"); }};
  const k = "--key=DEFECT#DEF-0001";
  const cases = [
    [["advance", k, "--to=awaiting-verification", "--candidate=r", "--evidence=verification-request:Q", "--reason=x"], /--attempt/],
    [["advance", k, "--to=awaiting-verification", "--attempt=A", "--candidate=r", "--reason=x"], /verification-request/],
    [["verify", k, "--attempt=A", "--outcome=passed", "--evidence=verification-run:R", "--reason=x"], /--candidate/],
    [["verify", k, "--attempt=A", "--candidate=r", "--outcome=passed", "--reason=x"], /verification-run/],
    [["verify", k, "--attempt=A", "--candidate=r", "--outcome=maybe", "--evidence=verification-run:R", "--reason=x"], /outcome/],
    [["verify", k, "--attempt=A", "--candidate=r", "--outcome=passed", "--evidence=verification-run:R", "--role=triager", "--reason=x"], /--role=verifier/],
    [["reopen-and-resume", k, "--attempt=B", "--work-item=W", "--reason=x"], /new-occurrence/],
    [["reopen-and-resume", k, "--evidence=new-occurrence:O", "--work-item=W", "--reason=x"], /--attempt/],
    [["reopen-and-resume", k, "--evidence=new-occurrence:O", "--attempt=B", "--reason=x"], /--work-item/],
    [["advance", k, "--to=reopened", "--reason=x"], /new-occurrence/]
  ];
  for (const [argv, message] of cases) {
    let identityCalls = 0;
    const out = [], err = [];
    const code = await runTriage({argv, table:TABLE, db:noAws, commands, identity:async () => { identityCalls++; return DEV; }, now, out:t => out.push(t), err:t => err.push(t)});
    assert.equal(code, 2, argv.join(" "));
    assert.match(err.join(""), message, argv.join(" "));
    assert.equal(identityCalls, 0, "no STS call either");
  }
});

test("I-23 planUpdate for a defect is a single conditional SET on revision+state (pure)", () => {
  const plan = planUpdate({table:"t", key:"DEFECT#DEF-1", current:{kind:"defect", state:"resolved", revision:5},
    changed:{state:"in-progress", revision:7, history:[]}});
  assert.equal(plan.ConditionExpression, "attribute_exists(pk) AND #kind = :kind AND revision = :expected AND #state = :before");
  assert.equal(plan.ExpressionAttributeValues[":expected"].N, "5");
  assert.equal(plan.ExpressionAttributeValues[":before"].S, "resolved");
  assert.equal(plan.ExpressionAttributeValues[":version"].N, "7");
});
