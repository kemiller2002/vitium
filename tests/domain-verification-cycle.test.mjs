// Verification cycle (VIT-LCY-010, VIT-LCY-011, VIT-VER-009 P0; groundwork VIT-LCY-012/013,
// VIT-VER-010/011; VIT-AC-033/034/036; mission section 7 gates).
// The multi-step `cycles` in schemas/lifecycle/transition-cases.v1.json are replayed here
// against service/lifecycle.mjs and by domain/Vitium.Domain.Tests against the F# core.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { table } from "../service/triage.mjs";
import {
  evaluateTransition, recordInconclusive, recordEscalation, reopenAndResume,
  agentRepairBudget, verificationCycle, loadTable
} from "../service/lifecycle.mjs";

const readJson = path => JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));
const { cycles } = readJson("schemas/lifecycle/transition-cases.v1.json");
const rawTable = readJson("schemas/lifecycle/transitions.v1.json");
const valueOf = (e, k) => e?.fields?.[k] ?? e?.[k];

/** Pure: apply one cycle step to a record. */
function applyStep(current, initial, s) {
  const record = s.from === "initial" ? initial : current;
  const expectedRevision = s.expectedRevision ?? record.revision;
  // The step's trusted caller context (VF-027) is passed as the context option, never in the command.
  const options = s.context ? { context: s.context } : {};
  switch (s.op) {
    case "transition": return evaluateTransition(table, record, { ...s.command, expectedRevision }, options);
    case "inconclusive": return recordInconclusive(table, record, { ...s.command, expectedRevision }, options);
    case "escalate": return recordEscalation(table, record, { ...s.command, expectedRevision }, options);
    case "reopenAndResume": return reopenAndResume(table, record, { ...s.reopen, expectedRevision }, s.resume, options);
    default: throw new Error("unknown op " + s.op);
  }
}

/** Pure: run a cycle; returns the final record and per-step outcomes. */
function runCycle(c) {
  let current = c.record;
  const outcomes = [];
  for (const s of c.steps) {
    const r = applyStep(current, c.record, s);
    outcomes.push(r);
    if (r.ok && s.from !== "initial") current = r.value.record;
  }
  return { final: current, outcomes };
}

for (const c of cycles) {
  test("shared cycle: " + c.name, () => {
    const before = JSON.stringify(c.record);
    const { final, outcomes } = runCycle(c);
    c.steps.forEach((s, i) => {
      const r = outcomes[i];
      assert.equal(r.ok, s.expect.ok, `step ${i + 1} (${s.op} ${s.command?.to ?? s.resume?.to ?? ""}): ${JSON.stringify(r.error)}`);
      if (s.expect.ok) assert.equal(r.value.record.state, s.expect.state, `step ${i + 1} state`);
      else assert.equal(r.error.code, s.expect.code, `step ${i + 1} code`);
    });
    assert.equal(final.revision, c.final.revision, "final revision");
    assert.equal(final.history.length, c.record.history.length + (c.final.revision - c.record.revision), "one event per revision");
    assert.deepEqual(final.history.slice(0, c.record.history.length), c.record.history, "prior history preserved verbatim");
    assert.equal(JSON.stringify(c.record), before, "input record not mutated");
    const submissions = final.history.filter(e => e.to === "awaiting-verification");
    const results = final.history.filter(e => e.type === "transition" && ["resolved", "in-progress"].includes(e.to) && e.from === "awaiting-verification");
    if (c.final.attempts) assert.deepEqual(submissions.map(e => valueOf(e, "attemptId")), c.final.attempts, "every attempt kept");
    if (c.final.candidates) assert.deepEqual(submissions.map(e => valueOf(e, "candidateRevision")), c.final.candidates, "every candidate kept");
    if (c.final.outcomes) assert.deepEqual(results.map(e => valueOf(e, "verificationOutcome")), c.final.outcomes, "every outcome kept");
  });
}

test("mission gate: >= 2 failed iterations precede the pass, each with failed evidence, verifier and candidate", () => {
  const c = cycles.find(x => x.name.startsWith("two failed iterations"));
  const { final } = runCycle(c);
  const failed = final.history.filter(e => valueOf(e, "verificationOutcome") === "failed");
  assert.ok(failed.length >= 2);
  for (const e of failed) {
    assert.equal(e.to, "in-progress");
    assert.equal(e.role, "verifier");
    assert.ok(e.evidence.some(x => x.kind === "verification-run"));
    assert.ok(valueOf(e, "candidateRevision"));
    assert.ok(e.reason);
  }
  const passed = final.history.at(-1);
  assert.equal(passed.to, "resolved");
  assert.notEqual(passed.actor, valueOf(final.history.findLast(e => e.to === "awaiting-verification"), "author"), "independent verifier");
  assert.ok(Object.isFrozen(final.history) && final.history.every(Object.isFrozen));
});

test("reopen-and-resume records both events, never skips reopened, and is all-or-nothing", () => {
  const c = cycles.find(x => x.name.startsWith("reopen and resume"));
  const { outcomes } = runCycle(c);
  const both = outcomes[0].value;
  assert.deepEqual(both.events.map(e => e.to), ["reopened", "in-progress"]);
  assert.deepEqual(both.record.history.slice(-2).map(e => e.to), ["reopened", "in-progress"]);
  assert.equal(both.events[0].reopens.state, "resolved", "reopen links the prior resolution");
  assert.equal(outcomes[1].ok, false);
  assert.equal(outcomes[1].error.detail?.step, "resume", "failure names the step that refused");
  assert.equal(reopenAndResume(table, c.record, { ...c.steps[0].reopen, expectedRevision: 1 }, { ...c.steps[0].resume, to: "triaged" }).error.code, "invalid_payload", "only in-progress or reproducing can follow");
});

test("bounded repair policy is a pure function with an explicit parameter and a provisional default", () => {
  assert.equal(table.policy.maxAutonomousFailedAttempts.provisional, true);
  const history = [1, 2].flatMap(n => [
    { to: "awaiting-verification", fields: { attemptId: "a-" + n }, sequence: 2 * n - 1 },
    { to: "in-progress", fields: { verificationOutcome: "failed" }, sequence: 2 * n }
  ]);
  assert.deepEqual({ ...agentRepairBudget(table, history) }, { failed: 2, max: 3, exhausted: false });
  assert.equal(agentRepairBudget(table, history, 2).exhausted, true, "explicit parameter wins");
  assert.equal(agentRepairBudget(table, [...history, { type: "escalation", sequence: 5 }], 2).exhausted, false, "escalation opens a new budget");
  assert.equal(agentRepairBudget(table, [...history, { to: "reopened", sequence: 5 }], 2).exhausted, false, "reopening opens a new cycle");
  assert.equal(agentRepairBudget(table, [...history, { type: "verification", fields: { verificationOutcome: "inconclusive" }, sequence: 5 }], 3).failed, 2, "inconclusive is not a failure");
  const refused = evaluateTransition(table, { kind: "defect", state: "in-progress", revision: 4, history },
    { to: "awaiting-verification", actor: "bot", role: "triager", reason: "retry", occurredAt: "2026-10-08T12:00:00Z", expectedRevision: 4, fields: { attemptId: "a-3", candidateRevision: "s-3" }, evidence: [{ kind: "verification-request", ref: "r" }] },
    { maxFailedAttempts: 2, context: { provenance: "agent" } });
  assert.equal(refused.error.code, "escalation_required", "evaluateTransition honours an explicit budget");
});

test("verificationCycle reads legacy top-level and v1.2 nested field shapes alike", () => {
  const cycle = verificationCycle([
    { to: "awaiting-verification", attemptId: "old", candidateRevision: "c-old", sequence: 1 },
    { to: "in-progress", verificationOutcome: "failed", sequence: 2 },
    { to: "awaiting-verification", fields: { attemptId: "new", candidateRevision: "c-new", author: "bot" }, sequence: 3 }
  ]);
  assert.deepEqual({ ...cycle.latestSubmission }, { attemptId: "new", candidateRevision: "c-new", author: "bot", actor: null, sequence: 3 });
  assert.deepEqual([...cycle.submittedAttempts], ["old", "new"]);
});

test("table loader refuses a non-provisional or missing repair budget", () => {
  const bad = structuredClone(rawTable);
  bad.policy.maxAutonomousFailedAttempts.provisional = false;
  assert.match(loadTable(bad).error.message, /provisional/);
  const none = structuredClone(rawTable);
  delete none.policy;
  assert.equal(loadTable(none).ok, false);
});

// ---- round 3: VF-025..VF-028 (trusted context, canonical identity, author, human pass) ----

test("VF-025: the recorded author is always the submitting actor, even when a matching variant is named", () => {
  const r = evaluateTransition(table, { kind: "defect", state: "in-progress", revision: 0, history: [] },
    { to: "awaiting-verification", actor: "dev-1", role: "triager", reason: "submit", occurredAt: "2026-10-08T12:00:00Z", expectedRevision: 0,
      fields: { attemptId: "a-1", candidateRevision: "c-1", author: "DEV-1" }, evidence: [{ kind: "verification-request", ref: "r" }] },
    { context: { provenance: "authenticated-human" } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.value.event.fields.author, "dev-1", "author recorded from the actor, not the caller-supplied spelling");
});

test("VF-026: canonicalActor is NFKC + trim + lower-case and is the only identity comparison", async () => {
  const { canonicalActor } = await import("../service/lifecycle.mjs");
  assert.equal(canonicalActor(" Dev-1 "), "dev-1");
  assert.equal(canonicalActor("Ｄｅｖ-1"), "dev-1", "full-width compatibility form folds");
  assert.notEqual(canonicalActor("dev-1"), canonicalActor("dev-2"));
  assert.equal(canonicalActor(undefined), "");
});

test("VF-027 / VF-035: triage-cli passes the CLASSIFIED caller provenance as trusted context (only an allow-listed human role session is not budget-bound)", async () => {
  const { decide } = await import("../service/triage-cli.mjs");
  const { classifyCaller, parseHumanRoleAllowList } = await import("../service/operator-identity.mjs");
  // Agent attempts fail until the budget is exhausted.
  const at = "2026-10-08T12:00:00Z";
  let record = { kind: "defect", id: "DEF-0900", state: "in-progress", revision: 0, history: [] };
  for (let n = 1; n <= table.policy.maxAutonomousFailedAttempts.value; n++) {
    record = evaluateTransition(table, record, { to: "awaiting-verification", actor: "bot", role: "triager", reason: "s", occurredAt: at, expectedRevision: record.revision,
      fields: { attemptId: "b-" + n, candidateRevision: "c-" + n }, evidence: [{ kind: "verification-request", ref: "r" + n }] }, { context: { provenance: "agent" } }).value.record;
    record = evaluateTransition(table, record, { to: "in-progress", actor: "qa", role: "verifier", reason: "f", occurredAt: at, expectedRevision: record.revision,
      fields: { attemptId: "b-" + n, candidateRevision: "c-" + n, verificationOutcome: "failed" }, evidence: [{ kind: "verification-run", ref: "f" + n }] }, { context: { provenance: "authenticated-human" } }).value.record;
  }
  assert.equal(agentRepairBudget(table, record.history).exhausted, true, "precondition: budget exhausted");
  const args = { command: "advance", to: "awaiting-verification", role: "triager", reason: "operator retry",
    fields: { attemptId: "op-1", candidateRevision: "c-op" }, evidence: [{ kind: "verification-request", ref: "req-op" }] };
  const allowList = parseHumanRoleAllowList("arn:aws:iam::123456789012:role/ops/VitiumTriager").value;
  const attempt = (actor, provenance) => decide({ args, record, actor, occurredAt: at, ...(provenance === undefined ? {} : { provenance }) });

  // (1) An assumed-role session of an allow-listed role is classified human -> not budget-bound.
  const humanSession = "arn:aws:sts::123456789012:assumed-role/VitiumTriager/kevin";
  const human = classifyCaller(humanSession, allowList);
  assert.equal(human.provenance, "authenticated-human", "precondition: allow-listed role session classifies as human");
  const r = attempt(humanSession, human.provenance);
  assert.equal(r.ok, true, "classified human operator is exempt from the agent budget: " + JSON.stringify(r.error));
  assert.equal(r.value.events[0].provenance, "authenticated-human");

  // (2) The same call by an IAM user, an unlisted role, a listed role in another account, or
  // with no classification at all is budget-bound (fail closed).
  for (const [name, actor] of [
    ["IAM user", "arn:aws:iam::123456789012:user/operator"],
    ["unlisted role session", "arn:aws:sts::123456789012:assumed-role/praxis-agent-runner/session-1"],
    ["listed role name in another account", "arn:aws:sts::999999999999:assumed-role/VitiumTriager/kevin"]
  ]) {
    const classified = classifyCaller(actor, allowList);
    assert.equal(classified.provenance, "agent", name + " classifies as agent");
    const refused = attempt(actor, classified.provenance);
    assert.equal(refused.error?.code, "escalation_required", name + " must be budget-bound");
  }
  assert.equal(attempt(humanSession, undefined).error?.code, "escalation_required", "missing classification is budget-bound");
  assert.equal(attempt(humanSession, "Authenticated-Human").error?.code, "escalation_required", "only the exact classifier value is trusted");
});
