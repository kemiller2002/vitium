// Regression tests for findings from the independent verification review of #14/#15.
// Each case reproduces an input that the first candidate accepted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transition, reopenAndResume, TransitionError } from "../service/triage.mjs";
import { normalizeMachineObservation, ObservationError } from "../service/machine-observation.mjs";
import { createOutbox, enqueue, drain, reportingGate } from "../service/machine-outbox.mjs";
import { proposeFromMachineObservation, acceptProposal } from "../service/verification-proposals.mjs";

const at = minute => new Date(Date.UTC(2026, 9, 8, 12, minute)).toISOString();
const base = (to, fields) => ({ to, reason: "r", role: "triager", actorKind: "human", occurredAt: at(0), ...fields });
const inProgress = { kind: "defect", id: "VIT-0042", state: "in-progress", revision: 0, history: [] };
const submitted = (actor = "alice", attemptId = "a1") => transition(inProgress, base("awaiting-verification",
  { actor, actorKind: "agent", attemptId, candidateRevision: "sha-1", evidenceId: "req-1", expectedRevision: 0 }));
const pass = (record, fields) => transition(record, base("resolved", { actor: "bob", role: "verifier", attemptId: "a1",
  candidateRevision: "sha-1", evidenceId: "pass-1", verificationOutcome: "passed", expectedRevision: record.revision, occurredAt: at(1), ...fields }));

test("finding 1: whitespace, case or Unicode width variants of the author cannot self-certify", () => {
  const waiting = submitted();
  for (const actor of [" alice ", "Alice", "ALICE", "ａlice"]) {
    for (const role of ["verifier", "administrator"]) {
      assert.throws(() => pass(waiting, { actor, role }), /cannot certify its own/, actor + "/" + role);
    }
  }
  assert.equal(pass(waiting).history.at(-1).actor, "bob");
});

test("finding 2: agents cannot dodge the retry budget by omitting actorKind or disabling the policy", () => {
  assert.throws(() => transition(inProgress, base("awaiting-verification", { actor: "bot", actorKind: undefined,
    attemptId: "a1", candidateRevision: "s", evidenceId: "e", expectedRevision: 0 })), /human or an agent/);
  for (const agentFailedAttemptLimit of [0, -1, 1.5, Infinity, "3", null]) {
    assert.throws(() => transition(inProgress, base("awaiting-verification", { actor: "bot", actorKind: "agent",
      attemptId: "a1", candidateRevision: "s", evidenceId: "e", expectedRevision: 0 }), { agentFailedAttemptLimit }), TransitionError, String(agentFailedAttemptLimit));
  }
  // An explicitly undefined policy value keeps the safe default instead of disabling it.
  assert.equal(submitted().state, "awaiting-verification");
  assert.equal(transition(inProgress, base("awaiting-verification", { actor: "bot", actorKind: "agent", attemptId: "a1",
    candidateRevision: "s", evidenceId: "e", expectedRevision: 0 }), { agentFailedAttemptLimit: undefined }).state, "awaiting-verification");
});

test("finding 3: forged, truncated or discontinuous history is refused", () => {
  const forged = { kind: "defect", state: "awaiting-verification", revision: 5, history: [
    { from: "in-progress", to: "awaiting-verification", actor: "bob", attemptId: "a1", candidateRevision: "sha-1", evidenceId: "req", sequence: 5 }] };
  assert.throws(() => pass(forged, { actor: "alice" }), /inconsistent/);
  const real = submitted();
  const truncated = { ...real, history: [] };
  assert.throws(() => pass(truncated), /inconsistent/);
  const broken = { ...real, revision: 2, history: [real.history[0], { ...real.history[0], from: "triaged", sequence: 2 }] };
  assert.throws(() => pass(broken), /continuous/);
  assert.throws(() => pass({ ...real, state: "awaiting-verification", history: [{ ...real.history[0], to: "in-progress" }] }), /record state/);
});

test("finding 4: attempt IDs are compared normalized, and non-text fields never reach history", () => {
  const failed = transition(submitted(), base("in-progress", { actor: "bob", role: "verifier", attemptId: "a1", candidateRevision: "sha-1",
    evidenceId: "fail-1", verificationOutcome: "failed", expectedRevision: 1, occurredAt: at(1) }));
  for (const attemptId of [" a1", "A1", "a1 "]) {
    assert.throws(() => transition(failed, base("awaiting-verification", { actor: "alice", actorKind: "agent", attemptId,
      candidateRevision: "sha-2", evidenceId: "req-2", expectedRevision: 2, occurredAt: at(2) })), /distinct attempt/, JSON.stringify(attemptId));
  }
  for (const [key, value] of [["evidenceId", { $where: "x" }], ["workItemId", 42], ["classification", ["a"]], ["attemptId", "x".repeat(201)]]) {
    assert.throws(() => transition({ kind: "defect", state: "new", revision: 0, history: [] },
      base("triaged", { actor: "t", expectedRevision: 0, [key]: value })), TransitionError, key);
  }
  const trimmed = transition(failed, base("awaiting-verification", { actor: " alice ", actorKind: "agent", attemptId: " a2 ",
    candidateRevision: "sha-2", evidenceId: "req-2", expectedRevision: 2, occurredAt: at(2) })).history.at(-1);
  assert.deepEqual([trimmed.actor, trimmed.attemptId], ["alice", "a2"]);
});

const now = "2026-10-08T12:00:00.000Z";
const token = "ghp_" + "a".repeat(36);
const envelope = patch => ({
  schemaVersion: "1.0", eventId: "0276f8ac-a673-4d62-85a7-5d2292ef0cdd", eventType: "observation.detected",
  source: { system: "ci", repository: "kemiller2002/vitium", installationId: "ci-1", version: "1.0.0" },
  subject: { commit: "f6a987d3c71ad2f4ced1711528e296a42c51d9f4", runId: "r-1", checkId: "c-1", environment: "ci", ...patch.subject },
  finding: { category: "test-failure", summary: "s", expected: "e", observed: "o", classification: "untriaged", confidence: "observed" },
  evidence: [{ kind: "check-run", uri: patch.uri ?? "https://example.com/run/1", sha256: "a".repeat(64) }],
  observedAt: "2026-10-08T12:00:00Z"
});

test("finding 5: credentials in URLs or identifiers and internal evidence hosts are refused", () => {
  const unsafe = [
    { uri: "https://example.com/x/" + token }, { uri: "https://example.com/x?t=" + token },
    { uri: "https://example.com/x?t=" + encodeURIComponent("password=hunter22") },
    { subject: { runId: token } }, { uri: "https://169.254.169.254/latest" }, { uri: "https://[::1]/x" },
    { uri: "https://localhost/x" }, { uri: "https://metadata.internal/x" }, { uri: "https://intranet/x" }
  ];
  for (const patch of unsafe) {
    assert.throws(() => normalizeMachineObservation(envelope(patch), now), ObservationError, JSON.stringify(patch));
  }
  assert.ok(normalizeMachineObservation(envelope({}), now));
});

test("validation errors never echo large attacker-chosen key names", () => {
  const raw = { ...envelope({}), ["k".repeat(30_000)]: 1 };
  assert.throws(() => normalizeMachineObservation(raw, now), error => error.message.length < 120);
});

test("finding 6: malformed Retry-After or policy values never crash the producer", async () => {
  const outbox = enqueue(createOutbox(), { eventId: "e-1" }, now);
  for (const retryAfterMs of ["abc", NaN, -5, Infinity, null]) {
    const after = await drain(outbox, async () => ({ status: 503, retryAfterMs }), now);
    assert.equal(after.pending[0].attempts, 1);
    assert.equal(reportingGate("failed", after).buildOutcome, "failed");
  }
  for (const policy of [{ ttlMs: Infinity }, { capacity: 0 }, { maxAttempts: -1 }, { baseDelayMs: 10, maxDelayMs: 5 }]) {
    assert.throws(() => createOutbox(policy), TypeError, JSON.stringify(policy));
  }
});

test("outbox refuses envelopes without an eventId and counts dropped events as undelivered", () => {
  let outbox = enqueue(createOutbox({ capacity: 1 }), {}, now);
  assert.equal(outbox.pending.length, 0);
  assert.equal(outbox.refused[0].reason, "missing-event-id");
  outbox = enqueue(enqueue(createOutbox({ capacity: 1 }), { eventId: "e-1" }, now), { eventId: "e-2" }, now);
  assert.deepEqual(reportingGate("passed", outbox).undelivered, ["e-1", "e-2"]);
});

test("finding 7: schema encodes the runtime's cross-field rules", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/machine-observation.schema.json", import.meta.url), "utf8"));
  const rules = JSON.stringify(schema.allOf);
  assert.match(rules, /verification\.failed.*verificationAttemptId/);
  assert.match(rules, /governance\.violation.*governance-violation/);
  assert.equal(schema.properties.finding.properties.summary.pattern, "\\S");
  assert.throws(() => normalizeMachineObservation({ ...envelope({}), finding: { ...envelope({}).finding, summary: "   " } }, now), ObservationError);
});

test("finding 8: a pass reported by the submitting workload is flagged and cannot be accepted", () => {
  const waiting = submitted("repo:kemiller2002/summa:agent");
  const item = { pk: "MOBS#x", principal: { subject: "repo:kemiller2002/summa:agent" }, provenance: "agent",
    envelope: { eventType: "verification.passed", subject: { commit: "sha-1" }, correlation: { defectId: "VIT-0042", verificationAttemptId: "a1" } } };
  const { proposal } = proposeFromMachineObservation(waiting, item);
  assert.equal(proposal.selfReported, true);
  assert.throws(() => acceptProposal(waiting, proposal, { actor: "bob", actorKind: "human", role: "verifier", reason: "ok",
    expectedRevision: 1, occurredAt: at(1) }), /not independent evidence/);
});

test("minor: Reopen and resume cannot be redirected to other states or reuse old evidence", () => {
  const resolved = pass(submitted());
  const reopen = { actor: "t", actorKind: "human", role: "triager", reason: "r", evidenceId: "new-run", affectedRelease: "v2", expectedRevision: 2, occurredAt: at(2) };
  const resume = { actor: "t", actorKind: "human", role: "triager", reason: "r", attemptId: "a9", workItemId: "WI-1", occurredAt: at(3) };
  assert.equal(reopenAndResume(resolved, { ...reopen, to: "closed" }, resume).history.at(-2).to, "reopened");
  assert.throws(() => reopenAndResume(resolved, reopen, { ...resume, to: "triaged" }), /in-progress or reproducing/);
  assert.throws(() => reopenAndResume(submitted(), reopen, resume), /resolved or closed/);
  assert.throws(() => reopenAndResume(resolved, { ...reopen, evidenceId: "pass-1" }, resume), /new recurrence evidence/);
});
