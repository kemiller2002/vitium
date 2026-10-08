// Dependency-free unit tests for effect adapters and composition (runs in `npm test`).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeDynamoStore, encodeObservation} from "../service/adapters/dynamodb-store.mjs";
import {makeTurnstileVerifier, interpretSiteverify} from "../service/adapters/turnstile-challenge.mjs";
import {readConfig, composeHandler} from "../service/aws-handler.mjs";
import {parseArgs, planUpdate, runTriage, buildCommand, parseEvidence} from "../service/triage-cli.mjs";

class Put { constructor(input){ this.input = input; this.kind = "put"; } }
class Get { constructor(input){ this.input = input; this.kind = "get"; } }
const item = {pk:"REQUEST#" + "a".repeat(64), reference:"VIT-" + "A".repeat(32), payloadHash:"b".repeat(64),
  report:{title:"t"}, screening:{flags:[]}, source:"public-api", visibility:"private", kind:"observation",
  status:"received", state:"received", disposition:"received", revision:0, history:[], receivedAt:"2026-10-08T00:00:00.000Z", reviewQueuePk:"QUEUE#pending"};
const err = name => Object.assign(new Error("x"), {name});

test("T-30 dynamo store maps SDK outcomes to typed results and never throws", async () => {
  const run = send => makeDynamoStore({client:{send}, tableName:"t", commands:{PutItemCommand:Put, GetItemCommand:Get}}).putOnce(item);
  const puts = [];
  assert.deepEqual(await run(async c => { puts.push(c); return {}; }), {ok:true, value:{created:true}});
  assert.equal(puts[0].input.ConditionExpression, "attribute_not_exists(pk)", "create must be conditional");
  assert.deepEqual(await run(async () => { throw err("ThrottlingException"); }), {ok:false, error:"throttled"});
  assert.deepEqual(await run(async () => { throw err("InternalServerError"); }), {ok:false, error:"unavailable"});
  const replay = await run(async c => { if (c.kind === "put") throw err("ConditionalCheckFailedException");
    return {Item:{reference:{S:item.reference}, payloadHash:{S:item.payloadHash}, receivedAt:{S:item.receivedAt}}}; });
  assert.equal(replay.value.created, false);
  assert.equal(replay.value.existing.reference, item.reference);
  assert.deepEqual(await run(async c => { if (c.kind === "put") throw err("ConditionalCheckFailedException"); return {}; }), {ok:false, error:"unavailable"});
  assert.equal(encodeObservation(item).reviewQueueSk.S, item.receivedAt + "#" + item.reference);
});

test("T-31 Turnstile adapter: hostname/action bound, misconfiguration and outages are typed", async () => {
  const opts = {expectedHostname:"vitium.echelonfoundry.com", expectedAction:"vitium-intake"};
  assert.deepEqual(interpretSiteverify({success:true, hostname:"vitium.echelonfoundry.com", action:"vitium-intake"}, opts), {ok:true, value:true});
  assert.deepEqual(interpretSiteverify({success:true, hostname:"evil.example", action:"vitium-intake"}, opts), {ok:true, value:false});
  assert.deepEqual(interpretSiteverify({success:true, hostname:"vitium.echelonfoundry.com", action:"other"}, opts), {ok:true, value:false});
  assert.deepEqual(interpretSiteverify({success:false, "error-codes":["timeout-or-duplicate"]}, opts), {ok:true, value:false});
  assert.deepEqual(interpretSiteverify({success:false, "error-codes":["invalid-input-secret"]}, opts), {ok:false, error:"misconfigured"});
  const sent = [];
  const verify = makeTurnstileVerifier({...opts, loadSecret:async () => "s3cret", fetch:async (url, init) => { sent.push([url, String(init.body)]); return {ok:false}; }});
  assert.deepEqual(await verify("tok-000000000000"), {ok:false, error:"unavailable"});
  assert.equal(sent[0][0], "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  const noSecret = makeTurnstileVerifier({...opts, loadSecret:async () => { throw new Error("denied"); }, fetch:async () => assert.fail("must not call provider")});
  assert.deepEqual(await noSecret("tok-000000000000"), {ok:false, error:"unavailable"});
  const hang = makeTurnstileVerifier({...opts, timeoutMs:20, loadSecret:async () => "s", fetch:(u, {signal}) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(err("AbortError"))))});
  assert.deepEqual(await hang("tok-000000000000"), {ok:false, error:"unavailable"});
});

test("T-32 Lambda config refuses anything but the exact canonical origin/host and a secrets ARN", () => {
  const good = {REPORTS_TABLE_NAME:"t", TURNSTILE_SECRET_ARN:"arn:aws:secretsmanager:us-east-1:000000000000:secret:x",
    ALLOWED_ORIGIN:"https://vitium.echelonfoundry.com", CHALLENGE_HOSTNAME:"vitium.echelonfoundry.com"};
  assert.equal(readConfig(good).ok, true);
  for (const patch of [{ALLOWED_ORIGIN:"*"}, {ALLOWED_ORIGIN:"https://vitium.echelonfoundry.com/"}, {CHALLENGE_HOSTNAME:"localhost"},
    {TURNSTILE_SECRET_ARN:"plain-secret-value"}, {REPORTS_TABLE_NAME:""}]) {
    assert.equal(readConfig({...good, ...patch}).ok, false, JSON.stringify(patch));
  }
});

test("T-33 composed handler wires store, verifier and logger (no AWS SDK needed)", async () => {
  const lines = [];
  const handle = composeHandler({
    config:{tableName:"t", secretArn:"arn:aws:secretsmanager:x", allowedOrigin:"https://vitium.echelonfoundry.com", expectedHostname:"vitium.echelonfoundry.com"},
    dynamo:{async send(){ return {}; }}, commands:{PutItemCommand:Put, GetItemCommand:Get},
    loadSecret:async () => "s", fetch:async () => ({ok:true, json:async () => ({success:true, hostname:"vitium.echelonfoundry.com", action:"vitium-intake"})}),
    log:r => lines.push(r)
  });
  const reply = await handle({rawPath:"/api/v1/reports", requestContext:{http:{method:"POST"}, requestId:"r"},
    headers:{origin:"https://vitium.echelonfoundry.com", "content-type":"application/json", "idempotency-key":crypto.randomUUID()},
    body:JSON.stringify({schemaVersion:"1.0", product:"Forma", impact:"Not sure", title:"t", actual:"a", expected:"e", privacyAcknowledged:true, challengeToken:"challenge-token-0001"})});
  assert.equal(reply.statusCode, 201);
  assert.equal(lines[0].code, "accepted");
});

test("T-34 triage CLI: pure parsing, queue-following update plan, no AWS call on bad input", async () => {
  assert.equal(parseArgs(["queue"]).value.queue, "QUEUE#pending");
  assert.equal(parseArgs(["queue", "--queue=quarantined"]).value.queue, "QUEUE#quarantined");
  assert.equal(parseArgs(["queue", "--queue=all"]).ok, false);
  assert.equal(parseArgs(["show", "--key=REQUEST#zz"]).error, "invalid_key");
  assert.equal(parseArgs(["scan"]).ok, false);
  const k = "--key=REQUEST#" + "a".repeat(64);
  assert.equal(parseArgs(["advance", k, "--to=reopened", "--reason=r"]).error, "missing_evidence");
  assert.deepEqual(parseArgs(["advance", k, "--to=reopened", "--reason=r", "--evidence=new-occurrence:OBS-1"]).value.evidence, [{kind:"new-occurrence", ref:"OBS-1"}]);
  assert.deepEqual(parseEvidence("a:1,b:x:y").value, [{kind:"a", ref:"1"}, {kind:"b", ref:"x:y"}]);
  assert.equal(parseEvidence("a:").ok, false);
  const cmd = buildCommand({args:parseArgs(["advance", k, "--to=classified", "--reason=r", "--classification=c"]).value,
    record:{revision:3}, actor:"arn:x", occurredAt:"2026-10-08T00:00:00.000Z"});
  assert.equal(cmd.provenance, "authenticated-human");
  assert.deepEqual(cmd.fields, {classification:"c"});
  assert.equal(cmd.expectedRevision, 3);
  assert.equal(cmd.evidenceId, undefined, "legacy untyped evidence shape is not used");
  const plan = s => planUpdate({table:"t", key:"k", current:{state:"quarantined", revision:0}, changed:{state:s, revision:1, history:[]}, reference:"R", receivedAt:"T"});
  assert.match(plan("accepted-for-triage").UpdateExpression, /reviewQueuePk = :queue/);
  assert.equal(plan("accepted-for-triage").ExpressionAttributeValues[":queue"].S, "QUEUE#pending");
  assert.match(plan("rejected").UpdateExpression, /REMOVE reviewQueuePk, reviewQueueSk/);
  assert.match(plan("rejected").ConditionExpression, /revision = :expected AND #state = :before/);
  const errs = [];
  const code = await runTriage({argv:["show", "--key=bad"], table:"t", db:{send:() => assert.fail("no AWS call")}, identity:() => assert.fail("no identity call"), out:() => {}, err:t => errs.push(t)});
  assert.equal(code, 2);
});

test("T-35 template keeps least-privilege, POST-only, canonical-origin invariants (text guard; full parse in test:integration)", () => {
  const t = readFileSync(new URL("../infra/aws/template.yaml", import.meta.url), "utf8");
  const actions = [...t.matchAll(/^\s*-\s*((?:dynamodb|secretsmanager|s3|kms|logs|lambda|iam):[A-Za-z*]+)\s*$/gm)].map(m => m[1]).sort();
  assert.deepEqual(actions, ["dynamodb:GetItem", "dynamodb:PutItem", "secretsmanager:GetSecretValue"]);
  assert.match(t, /dynamodb:Attributes:/);
  assert.match(t, /AllowCredentials: false/);
  assert.match(t, /DeletionProtectionEnabled: !Ref TableDeletionProtection/);
  assert.doesNotMatch(t, /^\s+FunctionName:/m, "fixed FunctionName collides across stacks");
  assert.match(t, /DeletionPolicy: Retain/);
  assert.doesNotMatch(t, /AllowOrigins:\s*\n\s*-\s*['"]?\*/);
});
