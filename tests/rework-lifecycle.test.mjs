import test from "node:test";
import assert from "node:assert/strict";
import { transition, reopenAndResume, verificationAttempts, failedAttemptsInCycle, TransitionError, defaultPolicy } from "../service/triage.mjs";
import { proposeFromMachineObservation, acceptProposal } from "../service/verification-proposals.mjs";

// Deterministic clock: each step is one minute after the previous one.
const clock = (() => { let minute = 0; return () => new Date(Date.UTC(2026, 9, 8, 12, minute++)).toISOString(); })();
const author = { actor: "agent-praxis-7", actorKind: "agent", role: "triager" };
const human = { actor: "maintainer-1", actorKind: "human", role: "triager" };
const verifier = { actor: "dokimos-verifier", actorKind: "agent", role: "verifier" };
const step = (record, to, fields = {}) => transition(record, {
  to, reason: "Recorded " + to, expectedRevision: record.revision, occurredAt: clock(), ...human, ...fields
});
const submit = (record, attemptId, candidateRevision, who = author) =>
  step(record, "awaiting-verification", { ...who, attemptId, candidateRevision, evidenceId: "request-" + attemptId, workItemId: "WI-77" });
const verify = (record, outcome, fields = {}) => {
  const [attempt] = verificationAttempts(record).slice(-1);
  const to = { passed: "resolved", failed: "in-progress", inconclusive: "awaiting-verification" }[outcome];
  return step(record, to, { ...verifier, attemptId: attempt.attemptId, candidateRevision: attempt.candidateRevision,
    evidenceId: outcome + "-run-" + attempt.attemptId, verificationOutcome: outcome, reason: "Regression test " + outcome, ...fields });
};
const newDefect = () => ({ kind: "defect", id: "VIT-0042", state: "new", revision: 0, history: [] });
const toInProgress = () => [
  r => step(r, "triaged"),
  r => step(r, "reproducing"),
  r => step(r, "confirmed", { evidenceId: "repro-1" }),
  r => step(r, "in-progress", { attemptId: "fix-1", workItemId: "WI-77" })
].reduce((record, apply) => apply(record), newDefect());

test("VIT-AC-033: two failed independent verifications and rework before a passing one", () => {
  const timeline = [
    r => submit(r, "fix-1", "sha-1"),
    r => verify(r, "failed"),
    r => submit(r, "fix-2", "sha-2"),
    r => verify(r, "failed"),
    r => submit(r, "fix-3", "sha-3"),
    r => verify(r, "passed")
  ];
  const states = [];
  const resolved = timeline.reduce((record, apply) => { const next = apply(record); states.push(next.state); return next; }, toInProgress());
  assert.deepEqual(states, ["awaiting-verification", "in-progress", "awaiting-verification", "in-progress", "awaiting-verification", "resolved"]);
  assert.equal(resolved.revision, resolved.history.length);
  assert.deepEqual(resolved.history.map(e => e.sequence), resolved.history.map((_, i) => i + 1), "append-only, gap-free sequence");
  const attempts = verificationAttempts(resolved);
  assert.deepEqual(attempts.map(a => [a.attemptId, a.candidateRevision, a.results.map(r => r.outcome).join()]),
    [["fix-1", "sha-1", "failed"], ["fix-2", "sha-2", "failed"], ["fix-3", "sha-3", "passed"]]);
  assert.ok(attempts.every(a => a.results.every(r => r.verifier === "dokimos-verifier" && r.evidenceId.endsWith(a.attemptId))));
  assert.equal(failedAttemptsInCycle(resolved.history), 2);
});

test("failed verification requires evidence, a reason and the submitted attempt; it never resolves", () => {
  const waiting = submit(toInProgress(), "fix-1", "sha-1");
  assert.throws(() => verify(waiting, "failed", { evidenceId: "" }), /Independent verification/);
  assert.throws(() => verify(waiting, "failed", { reason: " " }), /reason/);
  assert.throws(() => verify(waiting, "failed", { candidateRevision: "sha-0" }), /submitted candidate/);
  assert.throws(() => verify(waiting, "failed", { attemptId: "fix-0" }), /submitted candidate/);
  assert.throws(() => verify(waiting, "failed", { to: "resolved" }), /outcome must match/);
  assert.throws(() => verify(waiting, "failed", { evidenceId: "request-fix-1" }), /own result evidence/);
  assert.equal(verify(waiting, "failed").state, "in-progress");
});

test("attempt IDs are distinct per submission; reuse after a failure is refused", () => {
  const reworking = verify(submit(toInProgress(), "fix-1", "sha-1"), "failed");
  assert.throws(() => submit(reworking, "fix-1", "sha-2"), /distinct attempt/);
  assert.throws(() => submit(reworking, "fix-2", ""), /Candidate attempt/);
});

test("stale, out-of-order and old-candidate verification results are refused", () => {
  const first = submit(toInProgress(), "fix-1", "sha-1");
  const reworked = submit(verify(first, "failed"), "fix-2", "sha-2");
  // The old test result for fix-1 arrives after fix-2 was submitted.
  assert.throws(() => step(reworked, "resolved", { ...verifier, attemptId: "fix-1", candidateRevision: "sha-1",
    evidenceId: "late-pass", verificationOutcome: "passed" }), /submitted candidate/);
  // Old test applied to a new candidate revision.
  assert.throws(() => step(reworked, "resolved", { ...verifier, attemptId: "fix-2", candidateRevision: "sha-1",
    evidenceId: "pass", verificationOutcome: "passed" }), /submitted candidate/);
  // Concurrent writer used an outdated revision.
  assert.throws(() => transition(reworked, { to: "resolved", ...verifier, attemptId: "fix-2", candidateRevision: "sha-2",
    evidenceId: "pass", verificationOutcome: "passed", reason: "pass", expectedRevision: reworked.revision - 1, occurredAt: clock() }), /Stale/);
  // A result timestamped before the latest event is out of order.
  assert.throws(() => step(reworked, "resolved", { ...verifier, attemptId: "fix-2", candidateRevision: "sha-2",
    evidenceId: "pass", verificationOutcome: "passed", occurredAt: "2026-10-08T11:00:00.000Z" }), /Out-of-order/);
});

test("VIT-AC-036: the author cannot certify its own candidate, and forged outcomes are refused", () => {
  const waiting = submit(toInProgress(), "fix-1", "sha-1");
  assert.throws(() => verify(waiting, "passed", { actor: author.actor }), /cannot certify its own/);
  assert.throws(() => step(toInProgress(), "awaiting-verification", { ...author, attemptId: "fix-1", candidateRevision: "sha-1",
    evidenceId: "request", verificationOutcome: "passed" }), /only accepted on a verification result/);
  assert.throws(() => verify(waiting, "passed", { role: "triager" }), /Independent verification/);
  assert.throws(() => verify(waiting, "passed", { role: "machine" }), /not authorized/);
  // Explicit, recorded policy is required to relax independence; the default is strict.
  assert.equal(defaultPolicy.requireIndependentVerifier, true);
  const relaxed = transition(waiting, { to: "resolved", ...verifier, actor: author.actor, attemptId: "fix-1", candidateRevision: "sha-1",
    evidenceId: "pass", verificationOutcome: "passed", reason: "Low-risk policy", expectedRevision: waiting.revision, occurredAt: clock() },
    { requireIndependentVerifier: false });
  assert.equal(relaxed.state, "resolved");
});

test("inconclusive (flaky/infrastructure) runs neither resolve nor count as rework failures", () => {
  const waiting = submit(toInProgress(), "fix-1", "sha-1");
  assert.throws(() => verify(waiting, "inconclusive"), /recognised cause/);
  assert.throws(() => verify(waiting, "failed", { inconclusiveCause: "flaky" }), /inconclusive cause/);
  const flaky = verify(waiting, "inconclusive", { inconclusiveCause: "infrastructure" });
  assert.equal(flaky.state, "awaiting-verification");
  assert.equal(failedAttemptsInCycle(flaky.history), 0);
  const rerun = verify(flaky, "passed");
  assert.equal(rerun.state, "resolved");
  assert.deepEqual(verificationAttempts(rerun)[0].results.map(r => [r.outcome, r.inconclusiveCause]),
    [["inconclusive", "infrastructure"], ["passed", null]]);
});

test("agent retry budget stops autonomous rework and requires human escalation", () => {
  const cycle = (record, n) => verify(submit(record, "fix-" + n, "sha-" + n), "failed");
  const exhausted = [1, 2, 3].reduce(cycle, toInProgress());
  assert.equal(failedAttemptsInCycle(exhausted.history), defaultPolicy.agentFailedAttemptLimit);
  assert.throws(() => submit(exhausted, "fix-4", "sha-4"), /retry budget exhausted/);
  // Escalation is explicit and auditable: a human owner takes over and submits the next attempt.
  const escalated = submit(exhausted, "fix-4", "sha-4", human);
  assert.equal(escalated.history.at(-1).actorKind, "human");
  // A tighter policy stops sooner.
  const once = cycle(toInProgress(), 1);
  assert.equal(submit(once, "fix-2", "sha-2").state, "awaiting-verification");
  assert.throws(() => transition(once, { to: "awaiting-verification", ...author, attemptId: "fix-2",
    candidateRevision: "sha-2", evidenceId: "req", reason: "retry", expectedRevision: once.revision, occurredAt: clock() },
    { agentFailedAttemptLimit: 1 }), TransitionError);
});

const resolvedDefect = () => verify(submit(toInProgress(), "fix-1", "sha-1"), "passed");

test("VIT-AC-034: regression after resolution reopens, reworks and re-verifies with full lineage", () => {
  const resolved = resolvedDefect();
  const resolutionSequence = resolved.history.at(-1).sequence;
  assert.throws(() => step(resolved, "in-progress", { attemptId: "fix-2", workItemId: "WI-78" }), /not permitted/);
  const reopened = step(resolved, "reopened", { evidenceId: "MOBS#regression-run", affectedRelease: "v2.1.0", reason: "Same failure in v2.1.0" });
  assert.equal(reopened.history.at(-1).priorResolutionSequence, resolutionSequence);
  assert.throws(() => step(reopened, "in-progress", { attemptId: "fix-1", workItemId: "WI-78" }), /new work attempt/);
  const final = [
    r => step(r, "in-progress", { attemptId: "fix-2", workItemId: "WI-78" }),
    r => submit(r, "fix-2", "sha-2"),
    r => verify(r, "failed"),
    r => submit(r, "fix-3", "sha-3"),
    r => verify(r, "passed")
  ].reduce((record, apply) => apply(record), reopened);
  assert.equal(final.state, "resolved");
  // Every prior event, including the superseded original pass, survives unchanged.
  assert.deepEqual(final.history.slice(0, resolved.history.length), [...resolved.history]);
  assert.deepEqual(verificationAttempts(final).map(a => a.results.map(r => r.outcome).join()), ["passed", "failed", "passed"]);
  assert.equal(failedAttemptsInCycle(final.history), 1, "budget restarts per recurrence, history does not");
});

test("closed defects reopen under policy and reproduction may precede work", () => {
  const closed = step(resolvedDefect(), "closed");
  assert.throws(() => step(closed, "reopened", { evidenceId: "run-9" }), /affected release/);
  const reopened = step(closed, "reopened", { evidenceId: "run-9", affectedRelease: "v3.0.0" });
  assert.equal(reopened.history.at(-1).from, "closed");
  assert.equal(step(reopened, "reproducing").state, "reproducing");
});

test("Reopen and resume applies both guarded events atomically or neither", () => {
  const resolved = resolvedDefect();
  const reopen = { to: "reopened", ...human, reason: "Regression", evidenceId: "run-10", affectedRelease: "v2.2.0", expectedRevision: resolved.revision, occurredAt: clock() };
  const resumed = reopenAndResume(resolved, reopen, { ...human, reason: "Resume", attemptId: "fix-9", workItemId: "WI-90", occurredAt: clock() });
  assert.deepEqual(resumed.history.slice(-2).map(e => [e.from, e.to]), [["resolved", "reopened"], ["reopened", "in-progress"]]);
  assert.equal(resumed.revision, resolved.revision + 2);
  assert.throws(() => reopenAndResume(resolved, reopen, { ...human, reason: "Resume", occurredAt: clock() }), /new work attempt/);
  assert.equal(resolved.state, "resolved", "a failed combined command leaves no partial reopen");
});

const machineItem = (eventType, attemptId, commit, patch = {}) => ({
  pk: "MOBS#evt-" + eventType, provenance: "application", principal: { subject: "repo:kemiller2002/summa:dokimos" },
  envelope: { eventType, subject: { commit, workItemId: "WI-77" }, correlation: { defectId: "VIT-0042", verificationAttemptId: attemptId }, ...patch }
});

test("spec test 7: green builds, stale or forged machine results can only propose, never close", () => {
  const waiting = submit(toInProgress(), "fix-1", "sha-1");
  assert.equal(proposeFromMachineObservation(waiting, machineItem("observation.detected", "fix-1", "sha-1")).reason, "not-a-verification-result");
  assert.equal(proposeFromMachineObservation(waiting, machineItem("verification.passed", "fix-0", "sha-1")).reason, "stale-or-mismatched-attempt");
  assert.equal(proposeFromMachineObservation(waiting, machineItem("verification.passed", "fix-1", "sha-9")).reason, "stale-or-mismatched-attempt");
  assert.equal(proposeFromMachineObservation({ ...waiting, id: "VIT-9999" }, machineItem("verification.passed", "fix-1", "sha-1")).reason, "defect-mismatch");
  assert.equal(proposeFromMachineObservation(toInProgress(), machineItem("verification.passed", "fix-1", "sha-1")).reason, "defect-not-awaiting-verification");
  const { proposal } = proposeFromMachineObservation(waiting, machineItem("verification.passed", "fix-1", "sha-1"));
  assert.equal(proposal.to, "resolved");
  assert.equal(waiting.state, "awaiting-verification", "a proposal changes nothing by itself");
  const decision = { ...verifier, reason: "Independent regression pass", expectedRevision: waiting.revision, occurredAt: clock() };
  assert.throws(() => acceptProposal(waiting, proposal, { ...decision, actor: author.actor }), /cannot certify its own/);
  assert.throws(() => acceptProposal(waiting, proposal, { ...decision, role: "triager" }), /Independent verification/);
  const tampered = { ...proposal, verificationOutcome: "failed" };
  assert.throws(() => acceptProposal(waiting, tampered, decision), /outcome must match/);
  const resolved = acceptProposal(waiting, proposal, decision);
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.history.at(-1).evidenceId, "MOBS#evt-verification.passed");
  const failed = acceptProposal(waiting, proposeFromMachineObservation(waiting, machineItem("verification.failed", "fix-1", "sha-1")).proposal, decision);
  assert.equal(failed.state, "in-progress");
});
