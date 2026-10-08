// Producer-side outbox policy (VIT-INT-015, VIT-AC-035). Requirements doc items 3 and 4:
// retry exhaustion, 429, unavailable Vitium fail safely; the producer keeps its own build
// result independent of Vitium availability and sees delivery errors.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY, enqueue, createOutboxEntry, nextDelivery, classifyDelivery, isAckFor, reportWithDelivery, orderByCausation, checkPolicy } from "../service/machine/outbox.mjs";
import { example } from "./machine-fixtures.mjs";

const T0 = "2026-10-08T12:00:00.000Z";
const at = ms => new Date(Date.parse(T0) + ms).toISOString();
const policy = { ...DEFAULT_POLICY, baseDelayMs: 1000, maxDelayMs: 8000, maxAttempts: 5, expiresAfterMs: 3600000 };
const PID = "wl:ci:summa";
const fresh = () => enqueue(example("observation-detected.ci.v1.json"), T0, PID);
const EID = example("observation-detected.ci.v1.json").eventId;
// A genuine machine ack for the fixture event (shape produced by observation-core ackFor).
const ack = (over = {}) => ({ schemaVersion: "1.0", eventId: EID, principalId: "wl:ci:summa", observationId: "OBS-" + "1".repeat(32), receivedAt: T0, status: "recorded", replayed: false, ...over });
const OK201 = Object.freeze({ kind: "response", status: 201, body: ack() });
const step = (e, now, outcome, jitter) => { const r = nextDelivery(e, now, policy, outcome, jitter); assert.ok(r.ok, JSON.stringify(r)); return r.value; };

test("classification of delivery outcomes", () => {
  assert.equal(classifyDelivery(OK201, { eventId: EID, principalId: PID }), "delivered");
  assert.equal(classifyDelivery({ kind: "response", status: 200, body: ack({ replayed: true }) }, { eventId: EID, principalId: "wl:ci:summa" }), "delivered");
  for (const s of [429, 500, 502, 503, 504, 408]) assert.equal(classifyDelivery({ kind: "response", status: s }), "retry", String(s));
  assert.equal(classifyDelivery({ kind: "timeout" }), "retry");
  assert.equal(classifyDelivery({ kind: "network-error" }), "retry");
  assert.equal(classifyDelivery({ kind: "response", status: 409, body: { code: "causation_unknown" } }), "retry");
  assert.equal(classifyDelivery({ kind: "response", status: 409, body: { code: "event_conflict" } }), "permanent");
  assert.equal(classifyDelivery({ kind: "response", status: 401, body: { code: "principal_expired" } }), "reauthenticate");
  for (const s of [400, 401, 403, 413]) assert.equal(classifyDelivery({ kind: "response", status: s }), "permanent", String(s));
  assert.equal(classifyDelivery(undefined), "retry");
});

test("VF-033: a 2xx is delivered only with an ack for THIS eventId (and principal); otherwise a retryable protocol error", () => {
  const bad = [
    "<html>captive portal</html>", undefined, null, {}, [],
    ack({ eventId: "11111111-1111-4111-8111-111111111111" }),
    ack({ status: "received" }),
    ack({ schemaVersion: "2.0" }),
    ack({ observationId: undefined }),
    ack({ principalId: undefined }),
    ack({ replayed: "yes" })
  ];
  for (const body of bad) {
    assert.equal(isAckFor(body, { eventId: EID, principalId: PID }), false, JSON.stringify(body));
    const e = step(fresh(), T0, { kind: "response", status: 200, body });
    assert.equal(e.status, "pending", JSON.stringify(body));
    assert.deepEqual(e.lastError, { kind: "protocol-error", status: 200, code: "ack_mismatch" });
  }
  // Principal-scoped: an entry that knows its principal refuses another principal's ack.
  const scoped = enqueue(example("observation-detected.ci.v1.json"), T0, "wl:ci:summa");
  assert.equal(step(scoped, T0, { kind: "response", status: 201, body: ack({ principalId: "wl:ci:other" }) }).status, "pending");
  assert.equal(step(scoped, T0, OK201).status, "delivered");
  // Repeated unacknowledged 2xx exhausts into dead-letter, never "delivered".
  let e = fresh();
  for (let i = 0; i < policy.maxAttempts; i++) e = step(e, at(i * 10000), { kind: "response", status: 204 });
  assert.equal(e.status, "dead-letter");
  assert.equal(e.deadLetterReason, "retry-exhausted");
  assert.equal(reportWithDelivery(Object.freeze({ status: "passed" }), [e]).delivery.delivered, 0);
});

test("VF-036: delivery proof always needs the producer principal; without it nothing can ever be marked delivered", () => {
  const env = example("observation-detected.ci.v1.json");
  // Typed refusal at creation.
  for (const bad of [undefined, null, "", "has space", 42, "x".repeat(200)]) {
    const r = createOutboxEntry(env, T0, bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.error.code, "missing_principal");
  }
  assert.equal(createOutboxEntry({}, T0, PID).error.code, "invalid_entry");
  assert.equal(createOutboxEntry(env, "later", PID).error.code, "invalid_entry");
  const created = createOutboxEntry(env, T0, PID);
  assert.ok(created.ok);
  assert.equal(created.value.principalId, PID);
  assert.ok(Object.isFrozen(created.value));
  // Ack validation always compares the principal; an unknown expected principal matches nothing.
  assert.equal(isAckFor(ack(), { eventId: EID }), false);
  assert.equal(isAckFor(ack(), { eventId: EID, principalId: undefined }), false);
  assert.equal(isAckFor(ack(), { eventId: EID, principalId: PID }), true);
  assert.equal(isAckFor(ack({ principalId: "wl:someone-else" }), { eventId: EID, principalId: PID }), false);
  // A legacy principal-less entry: any 2xx, even a perfect ack for its eventId, dead-letters visibly.
  const legacy = enqueue(env, T0);
  assert.equal(legacy.principalId, null);
  for (const body of [ack(), ack({ principalId: "wl:someone-else" })]) {
    const e = step(legacy, T0, { kind: "response", status: 200, body });
    assert.equal(e.status, "dead-letter");
    assert.equal(e.deadLetterReason, "missing-principal");
    assert.equal(e.lastError.code, "missing_principal");
  }
  // It still retries 5xx normally (no premature loss).
  assert.equal(step(legacy, T0, { kind: "response", status: 503 }).status, "pending");
  // An invalid principal passed to enqueue is not trusted either.
  assert.equal(enqueue(env, T0, "bad principal").principalId, null);
});

test("bounded exponential backoff, capped at maxDelayMs", () => {
  let e = fresh();
  const delays = [];
  let now = T0;
  for (let i = 0; i < 4; i++) {
    e = step(e, now, { kind: "response", status: 503 }, 0.999999);
    delays.push(Date.parse(e.nextAttemptAt) - Date.parse(now));
    now = e.nextAttemptAt;
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  assert.ok(delays.every(d => d <= policy.maxDelayMs));
  // With zero jitter delays are half of the exponential value (equal jitter), still increasing.
  const z = step(fresh(), T0, { kind: "timeout" }, 0);
  assert.equal(Date.parse(z.nextAttemptAt) - Date.parse(T0), 500);
});

test("429 honours Retry-After but never beyond the policy ceiling", () => {
  const e = step(fresh(), T0, { kind: "response", status: 429, retryAfterMs: 30000 });
  assert.equal(Date.parse(e.nextAttemptAt) - Date.parse(T0), 30000);
  const capped = step(fresh(), T0, { kind: "response", status: 429, retryAfterMs: 10 ** 9 });
  assert.equal(Date.parse(capped.nextAttemptAt) - Date.parse(T0), policy.maxRetryAfterMs);
  assert.equal(capped.lastError.status, 429);
});

test("retry exhaustion dead-letters with the last error (never silently dropped)", () => {
  let e = fresh();
  let now = T0;
  for (let i = 0; i < policy.maxAttempts; i++) { e = step(e, now, { kind: "response", status: 503 }); now = at((i + 1) * 10000); }
  assert.equal(e.status, "dead-letter");
  assert.equal(e.deadLetterReason, "retry-exhausted");
  assert.equal(e.attempts, policy.maxAttempts);
  assert.equal(e.lastError.status, 503);
  assert.equal(e.nextAttemptAt, null);
  assert.equal(step(e, at(10 ** 7), OK201).status, "dead-letter", "terminal");
});

test("expiry dead-letters even without a new attempt", () => {
  const e = step(fresh(), at(policy.expiresAfterMs), undefined);
  assert.equal(e.status, "dead-letter");
  assert.equal(e.deadLetterReason, "expired");
  const notYet = step(fresh(), at(1), undefined);
  assert.equal(notYet.status, "pending");
  assert.equal(notYet.due, true);
});

test("permanent refusals dead-letter immediately; expired credential asks for re-authentication", () => {
  const forged = step(fresh(), T0, { kind: "response", status: 403, body: { code: "identity_mismatch" } });
  assert.equal(forged.status, "dead-letter");
  assert.equal(forged.deadLetterReason, "permanent-refusal");
  assert.equal(forged.lastError.code, "identity_mismatch");
  const expired = step(fresh(), T0, { kind: "response", status: 401, body: { code: "principal_expired" } });
  assert.equal(expired.status, "needs-credential");
});

test("delivered entries are terminal", () => {
  const d = step(fresh(), T0, OK201);
  assert.equal(d.status, "delivered");
  assert.equal(d.deliveredAt, T0);
  assert.equal(step(d, at(5), { kind: "response", status: 500 }).status, "delivered");
});

test("invalid policy or entry is a typed refusal, not an exception", () => {
  assert.equal(checkPolicy({ ...policy, maxAttempts: 0 }).ok, false);
  assert.equal(checkPolicy({ ...policy, baseDelayMs: 9000 }).ok, false);
  assert.equal(nextDelivery(fresh(), T0, { ...policy, maxAttempts: Infinity }).error.code, "invalid_policy");
  assert.equal(nextDelivery(null, T0, policy).error.code, "invalid_entry");
  assert.equal(nextDelivery(fresh(), "yesterday", policy).error.code, "invalid_time");
});

test("item 4: the producer's build result is returned untouched whatever happens to delivery", () => {
  const buildResult = Object.freeze({ status: "failed", tests: Object.freeze({ passed: 41, failed: 1 }) });
  let e = fresh();
  for (let i = 0; i < policy.maxAttempts; i++) e = step(e, at(i * 10000), { kind: "network-error" });
  const pending = step(enqueue(example("verification-failed.dokimos.v1.json"), T0, PID), T0, { kind: "response", status: 429 });
  const report = reportWithDelivery(buildResult, [e, pending]);
  assert.equal(report.buildResult, buildResult, "same object identity");
  assert.deepEqual(report.buildResult, { status: "failed", tests: { passed: 41, failed: 1 } });
  assert.equal(report.delivery.deadLettered, 1);
  assert.equal(report.delivery.pending, 1);
  assert.equal(report.delivery.failures.length, 2, "delivery errors are visible");
  assert.deepEqual(report.gates, []);
  // A passing build stays passing even when reporting fails; a mandatory policy adds a SEPARATE gate.
  const green = Object.freeze({ status: "passed" });
  const mandatory = reportWithDelivery(green, [e], { reportingMandatory: true });
  assert.equal(mandatory.buildResult.status, "passed");
  assert.deepEqual(mandatory.gates, [{ gate: "vitium-reporting", passed: false }]);
  assert.deepEqual(reportWithDelivery(green, [step(fresh(), T0, OK201)], { reportingMandatory: true }).gates, [{ gate: "vitium-reporting", passed: true }]);
});

test("delivery order respects causation; cycles are withheld for repair", () => {
  const a = example("observation-detected.ci.v1.json");
  const b = { ...example("verification-failed.dokimos.v1.json"), observedAt: "2026-10-08T11:00:00Z", correlation: { ...example("verification-failed.dokimos.v1.json").correlation, causationEventId: a.eventId } };
  const c = { ...example("governance-violation.ordo.v1.json") };
  const { ordered, cyclic } = orderByCausation([b, c, a]);
  const ids = ordered.map(e => e.eventId);
  assert.ok(ids.indexOf(a.eventId) < ids.indexOf(b.eventId), "cause before effect even though effect is older");
  assert.equal(ordered.length, 3);
  assert.deepEqual(cyclic, []);
  const x = { ...a, eventId: "11111111-1111-4111-8111-111111111111", correlation: { ...a.correlation, causationEventId: "22222222-2222-4222-8222-222222222222" } };
  const y = { ...a, eventId: "22222222-2222-4222-8222-222222222222", correlation: { ...a.correlation, causationEventId: "11111111-1111-4111-8111-111111111111" } };
  const cyc = orderByCausation([x, y, c]);
  assert.deepEqual(cyc.ordered.map(e => e.eventId), [c.eventId]);
  assert.deepEqual([...cyc.cyclic].sort(), [x.eventId, y.eventId]);
});
