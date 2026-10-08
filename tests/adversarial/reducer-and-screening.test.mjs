// Adversarial checks for code paths introduced during integration (fix round 1) whose
// guards survived the mutation appraisal: M24 (page-URL path screening), M38 (reducer
// receipt re-validation) and M43 (challenge required before send).
// VIT-AC-003/006/008, VIT-UX-004, VIT-API-003, SEC-001.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialState, transition } from "../../site/state.mjs";
import { makeIntake } from "../../service/intake.mjs";
import { CANARY } from "../verification/canaries.mjs";
import { validRequest, memoryStore, IDEMPOTENCY_KEY, CHALLENGE } from "../verification/contracts.mjs";

const TOKEN = "turnstile-token-abcdef123456";
const values = Object.freeze({
  product: "Forma", impact: "Not sure", title: "Save fails", actual: "Nothing happens.",
  expected: "It saves.", steps: "", pageUrl: "", privacyAcknowledged: true
});
const run = (state, ...events) => events.reduce((acc, e) => transition(acc.state, e), { state, effects: [] });
const reviewing = () => run(initialState("private"), { type: "ReviewRequested", values, requestId: randomUUID() });
const submitting = () => run(reviewing().state, { type: "ChallengeSolved", token: TOKEN }, { type: "SubmitRequested" });
const receiptBody = (patch = {}) => ({ schemaVersion: "1.0", reference: "VIT-" + "A".repeat(32), receivedAt: "2026-10-08T12:00:00.000Z", status: "received", replayed: false, ...patch });

test("VIT-API-003 / VIT-UX-004: send is refused until the challenge is solved; no HTTP effect is emitted (M43)", () => {
  const { state } = reviewing();
  assert.equal(state.phase, "reviewing");
  const attempt = transition(state, { type: "SubmitRequested" });
  assert.equal(attempt.state.phase, "reviewing", "must not enter submitting without a token");
  assert.equal(attempt.effects.filter(e => e.kind === "PerformHttp").length, 0, "no request without a challenge token");
  assert.equal(attempt.state.error?.code, "challenge_required");
  // Control: after the challenge the request is emitted exactly once and carries the token only in the body.
  const ok = submitting();
  assert.equal(ok.state.phase, "submitting");
  const http = ok.effects.filter(e => e.kind === "PerformHttp");
  assert.equal(http.length, 1);
  assert.ok(!String(http[0].request.url ?? http[0].request.endpoint ?? "").includes(TOKEN), "token never in the URL");
});

test("VIT-API-003: an expired challenge blocks send again (token cleared, no request)", () => {
  const solved = run(reviewing().state, { type: "ChallengeSolved", token: TOKEN }, { type: "ChallengeExpired" });
  const attempt = transition(solved.state, { type: "SubmitRequested" });
  assert.notEqual(attempt.state.phase, "submitting");
  assert.equal(attempt.effects.filter(e => e.kind === "PerformHttp").length, 0);
});

test("VIT-UX-004 / VIT-AC-003: the reducer accepts only a receipt that re-validates from the raw outcome (M38)", () => {
  const { state } = submitting();
  const correlationId = state.attempt.idempotencyKey;
  // A classifier/receipt mismatch must never reach "accepted": the raw body says 500.
  const forged = transition(state, {
    type: "SubmitCompleted", correlationId,
    outcome: { kind: "Success", status: 500, body: receiptBody() }
  });
  assert.notEqual(forged.state.phase, "accepted", "accepted on a non-2xx raw outcome");
  assert.equal(forged.state.receipt, null);
  // Control: a genuine 201 receipt is accepted and the draft is cleared.
  const genuine = transition(state, { type: "SubmitCompleted", correlationId, outcome: { kind: "Success", status: 201, body: receiptBody() } });
  assert.equal(genuine.state.phase, "accepted");
  assert.equal(genuine.state.receipt.reference, receiptBody().reference);
  assert.equal(genuine.state.values.actual, "");
});

test("VIT-AC-008 / SEC-001: a credential in the page-URL PATH never reaches storage or the receipt (M24)", async () => {
  const store = memoryStore();
  const intake = makeIntake({ store, verifyChallenge: async () => true, now: () => "2026-10-08T12:00:00.000Z" });
  const secret = CANARY.githubClassic;
  const result = await intake.submit(validRequest({ pageUrl: "https://example.com/reset/" + secret + "/confirm" }), { idempotencyKey: IDEMPOTENCY_KEY, challengeToken: CHALLENGE });
  const stored = JSON.stringify([...store.records.values()]);
  assert.ok(!stored.includes(secret), "token persisted via the sanitised page URL path");
  assert.ok(!JSON.stringify(result).includes(secret), "token echoed in the result");
  const record = [...store.records.values()][0];
  assert.ok(!record || record.state === "quarantined", "a redacted record must be quarantined");
});
