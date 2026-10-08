// Adversarial review of the verification cycle (Phase D2): VIT-LCY-010/011, VIT-VER-009,
// VIT-AC-033/034/036 and mission section 7. Drives service/lifecycle.mjs through the
// strict API with the DOM-001 table (transitions.v1.json 1.2.0).
// Tests marked { todo: "finding VF-xxx" } fail on p0/integration @ a574d44 and are findings.
import test from "node:test";
import assert from "node:assert/strict";
import { table } from "../../service/triage.mjs";
import { evaluateTransition, recordInconclusive, recordEscalation, reopenAndResume, agentRepairBudget } from "../../service/lifecycle.mjs";

const ts = "2026-10-08T12:00:00.000Z";
const human = (actor, role) => ({ actor, role, provenance: "authenticated-human" });
const agent = actor => ({ actor, role: "triager", provenance: "agent" });
const submit = (who, attemptId, candidateRevision, extra = {}) => ({
  to: "awaiting-verification", ...who, fields: { attemptId, candidateRevision, ...extra },
  evidence: [{ kind: "verification-request", ref: "vr-" + attemptId }]
});
const verdict = (to, who, attemptId, candidateRevision, extra = {}) => ({
  to, ...who, fields: { attemptId, candidateRevision, ...extra.fields },
  evidence: extra.evidence ?? [{ kind: "verification-run", ref: "run-" + attemptId + "-" + to }]
});
const VERIFIER = human("verifier-1", "verifier");
const DEV = human("dev-1", "triager");

/** Pure driver: apply commands in order, returning {record, results}. */
function drive(record, ...commands) {
  return commands.reduce(({ record: r, results }, c) => {
    const res = evaluateTransition(table, r, { expectedRevision: r.revision, occurredAt: ts, reason: "step", ...c });
    return { record: res.ok ? res.value.record : r, results: [...results, res] };
  }, { record, results: [] });
}
const inProgress = () => ({ kind: "defect", state: "in-progress", revision: 0, history: [] });

test("VIT-AC-033 / mission §7: two failed iterations, then an independent pass; every attempt and candidate preserved", () => {
  const { record, results } = drive(inProgress(),
    submit(DEV, "A1", "c1"), verdict("in-progress", VERIFIER, "A1", "c1"),
    submit(DEV, "A2", "c2"), verdict("in-progress", VERIFIER, "A2", "c2"),
    submit(DEV, "A3", "c3"), verdict("resolved", VERIFIER, "A3", "c3"));
  results.forEach((r, i) => assert.ok(r.ok, "step " + i + ": " + r.error?.code));
  assert.equal(record.state, "resolved");
  const outcomes = record.history.filter(e => e.fields?.verificationOutcome).map(e => [e.fields.attemptId, e.fields.candidateRevision, e.fields.verificationOutcome, e.evidence[0].ref]);
  assert.deepEqual(outcomes, [["A1", "c1", "failed", "run-A1-in-progress"], ["A2", "c2", "failed", "run-A2-in-progress"], ["A3", "c3", "passed", "run-A3-resolved"]]);
  assert.deepEqual(record.history.map(e => e.sequence), [1, 2, 3, 4, 5, 6]);
});

test("VIT-AC-034 / mission §7: later recurrence via reopen-and-resume keeps the earlier passing evidence byte-identical", () => {
  const passed = drive(inProgress(), submit(DEV, "A1", "c1"), verdict("resolved", VERIFIER, "A1", "c1")).record;
  const before = JSON.stringify(passed.history);
  const r = reopenAndResume(table, passed,
    { ...human("triager-1", "triager"), reason: "regression in 1.4", expectedRevision: passed.revision, occurredAt: ts, evidence: [{ kind: "new-occurrence", ref: "occ-1" }] },
    { to: "in-progress", ...human("triager-1", "triager"), reason: "resume", occurredAt: ts, fields: { attemptId: "A2", workItemId: "WI-9" } });
  assert.ok(r.ok, r.error?.code);
  assert.equal(JSON.stringify(r.value.record.history.slice(0, passed.history.length)), before);
  assert.deepEqual(r.value.events.map(e => e.to), ["reopened", "in-progress"]);
  assert.equal(r.value.record.history.at(-2).reopens?.state, "resolved");
});

test("VIT-LCY-011: reopen-and-resume is all-or-nothing (a refused resume leaves the input untouched and returns no events)", () => {
  const passed = drive(inProgress(), submit(DEV, "A1", "c1"), verdict("resolved", VERIFIER, "A1", "c1")).record;
  const snapshot = JSON.stringify(passed);
  // Resume reuses an already-submitted attemptId -> duplicate_attempt at step 2.
  const r = reopenAndResume(table, passed,
    { ...human("t", "triager"), reason: "r", expectedRevision: passed.revision, occurredAt: ts, evidence: [{ kind: "new-occurrence", ref: "o" }] },
    { to: "in-progress", ...human("t", "triager"), reason: "r", occurredAt: ts, fields: { attemptId: "A1", workItemId: "WI-1" } });
  assert.equal(r.ok, false);
  assert.equal(r.error.detail?.step, "resume");
  assert.equal(JSON.stringify(passed), snapshot);
  assert.equal(r.value, undefined);
});

test("VIT-VER-009: stale verification for an older attempt, an old attempt on a new candidate, and missing attempt fields are refused", () => {
  const awaiting = drive(inProgress(), submit(DEV, "X1", "c1"), verdict("in-progress", VERIFIER, "X1", "c1"), submit(DEV, "X2", "c2")).record;
  for (const [name, cmd, code] of [
    ["stale attempt", verdict("resolved", VERIFIER, "X1", "c1"), "attempt_mismatch"],
    ["old candidate on new attempt", verdict("resolved", VERIFIER, "X2", "c1"), "attempt_mismatch"],
    ["no attempt fields", { to: "resolved", ...VERIFIER, evidence: [{ kind: "verification-run", ref: "r" }] }, "missing_field"],
    ["failure without failure evidence", { ...verdict("in-progress", VERIFIER, "X2", "c2"), evidence: [] }, "missing_evidence"],
    ["failure with non-run evidence", verdict("in-progress", VERIFIER, "X2", "c2", { evidence: [{ kind: "supporting", ref: "s" }] }), "missing_evidence"],
    ["inconclusive used to resolve", verdict("resolved", VERIFIER, "X2", "c2", { fields: { verificationOutcome: "inconclusive" } }), "outcome_mismatch"],
    ["inconclusive used to fail", verdict("in-progress", VERIFIER, "X2", "c2", { fields: { verificationOutcome: "inconclusive" } }), "outcome_mismatch"],
    ["author role resolves", verdict("resolved", DEV, "X2", "c2"), "unauthorized_role"]
  ]) {
    const r = drive(awaiting, cmd).results[0];
    assert.equal(r.ok, false, name);
    assert.equal(r.error.code, code, name);
  }
});

test("VIT-VER-010 / VIT-AC-036: inconclusive is neither a pass nor a failure; the same attempt can be re-run", () => {
  const awaiting = drive(inProgress(), submit(DEV, "I1", "c1")).record;
  const inc = recordInconclusive(table, awaiting, { ...VERIFIER, reason: "flaky", expectedRevision: awaiting.revision, occurredAt: ts, fields: { attemptId: "I1", candidateRevision: "c1" }, evidence: [{ kind: "verification-run", ref: "r1" }] });
  assert.ok(inc.ok);
  assert.equal(inc.value.record.state, "awaiting-verification");
  assert.equal(agentRepairBudget(table, inc.value.record.history).failed, 0);
  assert.equal(drive(inc.value.record, verdict("resolved", VERIFIER, "I1", "c1")).results[0].ok, true, "re-run of the same attempt");
});

test("mission §7 / VIT-VER-011: the agent budget stops a single agent identity and only a human escalation reopens it", () => {
  let r = inProgress();
  for (let i = 1; i <= 3; i += 1) r = drive(r, submit(agent("bot"), "B" + i, "c" + i), verdict("in-progress", VERIFIER, "B" + i, "c" + i)).record;
  const blocked = drive(r, submit(agent("bot"), "B4", "c4")).results[0];
  assert.equal(blocked.error?.code, "escalation_required");
  const agentEscalation = recordEscalation(table, r, { ...agent("bot"), role: "triager", reason: "self", expectedRevision: r.revision, occurredAt: ts });
  assert.equal(agentEscalation.ok, false, "an agent cannot record the escalation that resets its own budget");
  const esc = recordEscalation(table, r, { ...human("lead", "triager"), reason: "approved", expectedRevision: r.revision, occurredAt: ts });
  assert.ok(esc.ok);
  assert.equal(drive(esc.value.record, submit(agent("bot"), "B4", "c4")).results[0].ok, true);
});

test("VIT-VER-011: the agent budget counts per defect cycle, so alternating agent actor names does not bypass it", () => {
  let r = inProgress();
  for (let i = 1; i <= 3; i += 1) r = drive(r, submit(agent("bot-" + i), "N" + i, "c" + i), verdict("in-progress", VERIFIER, "N" + i, "c" + i)).record;
  assert.equal(drive(r, submit(agent("bot-renamed"), "N4", "c4")).results[0].error?.code, "escalation_required");
});

test("VIT-VER-009 / VIT-VER-010: an inconclusive run cannot be recorded against an older attempt or candidate (V10)", () => {
  const awaiting = drive(inProgress(), submit(DEV, "Z1", "c1"), verdict("in-progress", VERIFIER, "Z1", "c1"), submit(DEV, "Z2", "c2")).record;
  for (const [attemptId, candidateRevision] of [["Z1", "c1"], ["Z2", "c1"], ["Z1", "c2"]]) {
    const r = recordInconclusive(table, awaiting, { ...VERIFIER, reason: "flaky", expectedRevision: awaiting.revision, occurredAt: ts, fields: { attemptId, candidateRevision }, evidence: [{ kind: "verification-run", ref: "r" }] });
    assert.equal(r.error?.code, "attempt_mismatch", attemptId + "/" + candidateRevision);
  }
  const ok = recordInconclusive(table, awaiting, { ...VERIFIER, reason: "flaky", expectedRevision: awaiting.revision, occurredAt: ts, fields: { attemptId: "Z2", candidateRevision: "c2" }, evidence: [{ kind: "verification-run", ref: "r" }] });
  assert.ok(ok.ok, "control: the latest attempt accepts an inconclusive run");
});

// ---- findings ---------------------------------------------------------------------------

test("VIT-AC-036 / VIT-VER-006: the submitter cannot name a different author and then pass its own attempt", { todo: "finding VF-025" }, () => {
  const awaiting = drive(inProgress(), submit(DEV, "Q1", "c1", { author: "someone-else" })).record;
  const self = drive(awaiting, verdict("resolved", human("dev-1", "verifier"), "Q1", "c1")).results[0];
  assert.equal(self.ok, false, "dev-1 submitted and passed its own candidate");
});

test("VIT-AC-036: actor identity comparison is not defeated by case or Unicode variants of the same actor", { todo: "finding VF-026" }, () => {
  const awaiting = drive(inProgress(), submit(DEV, "S1", "c1")).record;
  for (const alias of ["DEV-1", "Dev-1"]) {
    const r = drive(awaiting, verdict("resolved", human(alias, "verifier"), "S1", "c1")).results[0];
    assert.equal(r.ok, false, alias + " resolved dev-1's own attempt");
  }
});

test("mission §7 / VIT-VER-011: an agent cannot evade the repair budget by omitting provenance (legacy shape) or claiming human provenance", { todo: "finding VF-027" }, async () => {
  const { tryTransition } = await import("../../service/triage.mjs");
  let r = inProgress();
  for (let i = 1; i <= 3; i += 1) r = drive(r, submit(agent("bot"), "P" + i, "c" + i), verdict("in-progress", VERIFIER, "P" + i, "c" + i)).record;
  const legacy = tryTransition(r, { to: "awaiting-verification", actor: "bot", role: "triager", reason: "again", expectedRevision: r.revision, occurredAt: ts, attemptId: "P4", candidateRevision: "c4", evidenceId: "vr-4" });
  assert.equal(legacy.ok, false, "legacy shape (provenance 'unrecorded') bypassed the exhausted agent budget");
});

test("VIT-AC-036 / VIT-VER-006: an agent-provenance verifier cannot record a passing result (independent human or qualified process required)", { todo: "finding VF-028" }, () => {
  const awaiting = drive(inProgress(), submit(DEV, "G1", "c1")).record;
  const r = drive(awaiting, verdict("resolved", { actor: "agent-verifier", role: "verifier", provenance: "agent" }, "G1", "c1")).results[0];
  assert.equal(r.ok, false, "an agent resolved the defect");
});
