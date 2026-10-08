// VF-035 (mission section 7 gate 4, VIT-VER-011, VIT-AC-036): the operator CLI derives actor
// kind from the STS caller identity against an explicit human-role allow-list, failing closed.
import test from "node:test";
import assert from "node:assert/strict";
import {parseRoleArn, parseAssumedRoleArn, parseHumanRoleAllowList, classifyCaller, HUMAN_ROLE_ENV} from "../service/operator-identity.mjs";
import {runTriage, decide} from "../service/triage-cli.mjs";
import {table} from "../service/triage.mjs";
import {evaluateTransition} from "../service/lifecycle.mjs";

const A = "111122223333";
const B = "444455556666";
const allow = text => parseHumanRoleAllowList(text).value;
const LIST = allow(`arn:aws:iam::${A}:role/ops/humans/TriageOperator, arn:aws:iam::${A}:role/VerifierOperator`);
const session = (role, acct = A, part = "aws") => `arn:${part}:sts::${acct}:assumed-role/${role}/alice@example.org`;

test("OI-01 assumed-role ARNs parse to the role name; path-qualified role ARNs parse to the same name", () => {
  assert.deepEqual({...parseAssumedRoleArn(session("TriageOperator")).value}, {partition:"aws", account:A, roleName:"TriageOperator", session:"alice@example.org"});
  assert.equal(parseRoleArn(`arn:aws:iam::${A}:role/ops/humans/TriageOperator`).value.roleName, "TriageOperator");
  assert.equal(parseRoleArn(`arn:aws-us-gov:iam::${A}:role/X`).value.partition, "aws-us-gov");
  for (const bad of ["", "TriageOperator", `arn:aws:iam::${A}:user/TriageOperator`, `arn:aws:iam::${A}:role/`, `arn:aws:iam::12345:role/X`,
    `arn:aws:sts::${A}:assumed-role/TriageOperator/s`, `arn:aws:iam::${A}:role/*`]) {
    assert.equal(parseRoleArn(bad).ok, false, bad);
  }
  for (const bad of [`arn:aws:iam::${A}:role/TriageOperator`, `arn:aws:iam::${A}:user/alice`, `arn:aws:sts::${A}:federated-user/alice`,
    `arn:aws:iam::${A}:root`, `arn:aws:sts::${A}:assumed-role/TriageOperator`, `arn:aws:sts::${A}:assumed-role/a/b/c`]) {
    assert.equal(parseAssumedRoleArn(bad).ok, false, bad);
  }
});

test("OI-02 only an exact (partition, account, role name) match is human; everything else is agent", () => {
  const human = arn => classifyCaller(arn, LIST).provenance;
  assert.equal(human(session("TriageOperator")), "authenticated-human", "path-qualified allow-list entry matches the session");
  assert.equal(human(session("VerifierOperator")), "authenticated-human");
  for (const [label, arn] of [
    ["look-alike suffix", session("TriageOperatorBot")],
    ["look-alike prefix", session("XTriageOperator")],
    ["case variant", session("triageoperator")],
    ["agent role", session("praxis-agent-runner")],
    ["other account", session("TriageOperator", B)],
    ["other partition", session("TriageOperator", A, "aws-cn")],
    ["iam user named like the role", `arn:aws:iam::${A}:user/TriageOperator`],
    ["root", `arn:aws:iam::${A}:root`],
    ["federated user", `arn:aws:sts::${A}:federated-user/TriageOperator`],
    ["role ARN instead of session", `arn:aws:iam::${A}:role/TriageOperator`],
    ["trailing junk", session("TriageOperator") + "/x"],
    ["not a string", undefined]
  ]) assert.equal(human(arn), "agent", label);
});

test("OI-03 the allow-list has no defaults and a malformed entry fails the whole configuration", () => {
  for (const unset of [undefined, null, "", "  ", ","]) {
    const list = parseHumanRoleAllowList(unset);
    assert.equal(list.ok, true);
    assert.deepEqual([...list.value], []);
    assert.equal(classifyCaller(session("TriageOperator"), list.value).provenance, "agent", "unset -> everyone is an agent");
  }
  for (const bad of ["*", `arn:aws:iam::${A}:role/*`, `arn:aws:iam::${A}:role/Ok,not-an-arn`, `arn:aws:iam::${A}:user/alice`]) {
    const r = parseHumanRoleAllowList(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error.message, new RegExp(HUMAN_ROLE_ENV));
  }
});

// Domain consequences at the CLI boundary (decide is pure; provenance comes from classifyCaller).
const at = "2026-10-08T12:00:00Z";
function exhaustedRecord() {
  let record = {kind:"defect", id:"DEF-0901", state:"in-progress", revision:0, history:[]};
  for (let n = 1; n <= table.policy.maxAutonomousFailedAttempts.value; n++) {
    record = evaluateTransition(table, record, {to:"awaiting-verification", actor:"bot", role:"triager", reason:"s", occurredAt:at, expectedRevision:record.revision,
      fields:{attemptId:"b-" + n, candidateRevision:"c-" + n}, evidence:[{kind:"verification-request", ref:"r" + n}]}, {context:{provenance:"agent"}}).value.record;
    record = evaluateTransition(table, record, {to:"in-progress", actor:"qa", role:"verifier", reason:"f", occurredAt:at, expectedRevision:record.revision,
      fields:{attemptId:"b-" + n, candidateRevision:"c-" + n, verificationOutcome:"failed"}, evidence:[{kind:"verification-run", ref:"f" + n}]}, {context:{provenance:"authenticated-human"}}).value.record;
  }
  return record;
}
const submitArgs = {command:"advance", to:"awaiting-verification", role:"triager", reason:"retry",
  fields:{attemptId:"x-1", candidateRevision:"c-x"}, evidence:[{kind:"verification-request", ref:"rq"}]};

test("OI-04 an agent session is budget-bound; an allow-listed human session is not; a missing classification is agent", () => {
  const record = exhaustedRecord();
  const agentArn = session("praxis-agent-runner");
  const humanArn = session("TriageOperator");
  const asAgent = decide({args:submitArgs, record, actor:agentArn, occurredAt:at, provenance:classifyCaller(agentArn, LIST).provenance});
  assert.equal(asAgent.ok, false);
  assert.equal(asAgent.error.code, "escalation_required");
  assert.equal(decide({args:submitArgs, record, actor:humanArn, occurredAt:at}).ok, false, "no classification -> agent");
  assert.equal(decide({args:submitArgs, record, actor:humanArn, occurredAt:at, provenance:"application"}).ok, false, "only authenticated-human is trusted");
  const asHuman = decide({args:submitArgs, record, actor:humanArn, occurredAt:at, provenance:classifyCaller(humanArn, LIST).provenance});
  assert.equal(asHuman.ok, true, JSON.stringify(asHuman.error));
  assert.equal(asHuman.value.events[0].provenance, "authenticated-human");
});

test("OI-05 an agent session cannot record a passing verification; it may record failed and inconclusive", () => {
  let record = {kind:"defect", id:"DEF-0902", state:"in-progress", revision:0, history:[]};
  record = evaluateTransition(table, record, {to:"awaiting-verification", actor:"dev", role:"triager", reason:"s", occurredAt:at, expectedRevision:0,
    fields:{attemptId:"a-1", candidateRevision:"c-1"}, evidence:[{kind:"verification-request", ref:"r"}]}, {context:{provenance:"authenticated-human"}}).value.record;
  const agentArn = session("praxis-agent-runner");
  const p = classifyCaller(agentArn, LIST).provenance;
  const result = (outcome, to) => decide({args:{command:"advance", to, role:"verifier", reason:outcome,
    fields:{attemptId:"a-1", candidateRevision:"c-1", verificationOutcome:outcome}, evidence:[{kind:"verification-run", ref:"run"}]},
    record, actor:agentArn, occurredAt:at, provenance:p});
  const passed = result("passed", "resolved");
  assert.equal(passed.ok, false);
  assert.equal(passed.error.code, "human_verifier_required");
  assert.equal(result("failed", "in-progress").ok, true);
  const inconclusive = decide({args:{command:"verify", role:"verifier", reason:"flaky", fields:{attemptId:"a-1", candidateRevision:"c-1"},
    evidence:[{kind:"verification-run", ref:"run2"}]}, record, actor:agentArn, occurredAt:at, provenance:p});
  assert.equal(inconclusive.ok, true, JSON.stringify(inconclusive.error));
});

test("OI-06 runTriage: no CLI flag or body can choose actor kind; bad allow-list config is refused before AWS", async () => {
  const noAws = {async send() { throw new Error("AWS must not be called"); }};
  const run = (argv, humanOperatorRoles) => {
    const err = [];
    return runTriage({argv, table:"t", db:noAws, commands:{}, identity:async () => assert.fail("no STS call"), now:() => at,
      humanOperatorRoles, out:() => {}, err:t => err.push(t)}).then(code => ({code, err:err.join("")}));
  };
  const bad = await run(["show", "--key=DEFECT#DEF-1234"], "*");
  assert.equal(bad.code, 2);
  assert.match(bad.err, new RegExp(HUMAN_ROLE_ENV));
  // Flags that look like actor-kind switches are ignored: classification uses the STS ARN only.
  let seen;
  const capture = {async send(cmd) { seen = cmd; return {Item:{kind:{S:"defect"}, id:{S:"DEF-1234"}, state:{S:"in-progress"}, revision:{N:"0"}, history:{S:"[]"}}}; }};
  const out = [];
  const code = await runTriage({argv:["advance", "--key=DEFECT#DEF-1234", "--to=awaiting-verification", "--attempt=f1", "--candidate=c1",
      "--evidence=verification-request:q", "--reason=r", "--provenance=authenticated-human", "--actor-kind=human"],
    table:"t", db:{async send(cmd) { if (cmd.constructor.name === "Upd") return {}; return capture.send(cmd); }},
    commands:{GetItemCommand:class Get { constructor(i) { this.input = i; } }, UpdateItemCommand:class Upd { constructor(i) { this.input = i; } }},
    identity:async () => session("praxis-agent-runner"), now:() => at, humanOperatorRoles:`arn:aws:iam::${A}:role/TriageOperator`,
    out:t => out.push(t), err:() => {}});
  assert.equal(code, 0);
  assert.equal(JSON.parse(out.join("")).provenance, "agent", "flags must not grant authenticated-human");
  assert.ok(seen);
});
