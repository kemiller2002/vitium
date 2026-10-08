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
  switch (s.op) {
    case "transition": return evaluateTransition(table, record, { ...s.command, expectedRevision });
    case "inconclusive": return recordInconclusive(table, record, { ...s.command, expectedRevision });
    case "escalate": return recordEscalation(table, record, { ...s.command, expectedRevision });
    case "reopenAndResume": return reopenAndResume(table, record, { ...s.reopen, expectedRevision }, s.resume);
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
    { to: "awaiting-verification", actor: "bot", provenance: "agent", role: "triager", reason: "retry", occurredAt: "2026-10-08T12:00:00Z", expectedRevision: 4, fields: { attemptId: "a-3", candidateRevision: "s-3" }, evidence: [{ kind: "verification-request", ref: "r" }] },
    { maxFailedAttempts: 2 });
  assert.equal(refused.error.code, "escalation_required", "evaluateTransition honours an explicit budget");
});

test("verificationCycle reads legacy top-level and v1.2 nested field shapes alike", () => {
  const cycle = verificationCycle([
    { to: "awaiting-verification", attemptId: "old", candidateRevision: "c-old", sequence: 1 },
    { to: "in-progress", verificationOutcome: "failed", sequence: 2 },
    { to: "awaiting-verification", fields: { attemptId: "new", candidateRevision: "c-new", author: "bot" }, sequence: 3 }
  ]);
  assert.deepEqual({ ...cycle.latestSubmission }, { attemptId: "new", candidateRevision: "c-new", author: "bot", sequence: 3 });
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
