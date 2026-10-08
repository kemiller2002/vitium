import test from "node:test";
import assert from "node:assert/strict";
import { createOutbox, enqueue, due, drain, applyDeliveryResult, reportingGate, backoffMs } from "../service/machine-outbox.mjs";

const t0 = "2026-10-08T12:00:00.000Z";
const at = ms => new Date(Date.parse(t0) + ms).toISOString();
const event = (id, patch = {}) => ({ eventId: id, correlation: { causationEventId: null }, ...patch });

test("spec test 4: an outage never changes the producer's failed build result", async () => {
  const outbox = enqueue(createOutbox(), event("e-1"), t0);
  const after = await drain(outbox, async () => { throw new Error("ECONNREFUSED"); }, t0);
  const gate = reportingGate("failed", after);
  assert.equal(gate.buildOutcome, "failed");
  assert.equal(gate.reporting, "pending");
  assert.equal(gate.reportingGate, "passed", "optional reporting is not a gate");
  assert.deepEqual(gate.undelivered, ["e-1"]);
  assert.equal(after.pending[0].lastError, "transport:ECONNREFUSED");
  // A passing build stays passing even when reporting is a mandatory separate gate.
  const mandatory = reportingGate("passed", after, { mandatory: true });
  assert.equal(mandatory.buildOutcome, "passed");
  assert.equal(mandatory.reportingGate, "failed");
});

test("retries back off, honour Retry-After, and dead-letter after the bounded attempt limit", async () => {
  let outbox = enqueue(createOutbox({ maxAttempts: 3, baseDelayMs: 1000 }), event("e-1"), t0);
  outbox = applyDeliveryResult(outbox, "e-1", { status: 429, retryAfterMs: 30_000 }, t0);
  assert.equal(outbox.pending[0].nextAttemptAt, at(30_000));
  assert.deepEqual(due(outbox, at(29_999)), []);
  outbox = applyDeliveryResult(outbox, "e-1", { status: 503 }, at(30_000));
  assert.equal(outbox.pending[0].nextAttemptAt, at(32_000));
  outbox = applyDeliveryResult(outbox, "e-1", { status: 503 }, at(32_000));
  assert.equal(outbox.pending.length, 0);
  assert.equal(outbox.deadLetters[0].reason, "retry-exhausted");
  assert.equal(outbox.deadLetters[0].attempts, 3);
  assert.equal(outbox.deadLetters[0].envelope.eventId, "e-1", "diagnostic payload is preserved for repair");
  assert.equal(reportingGate("failed", outbox).reporting, "failed");
  const passedBuild = reportingGate("passed", outbox, { mandatory: true });
  assert.deepEqual([passedBuild.buildOutcome, passedBuild.reportingGate], ["passed", "failed"], "dead letters never rewrite the build result");
  assert.equal(backoffMs(outbox.policy, 30, 0), outbox.policy.maxDelayMs);
});

test("expiry dead-letters before an unbounded wait", () => {
  let outbox = enqueue(createOutbox({ ttlMs: 5_000, baseDelayMs: 4_000 }), event("e-1"), t0);
  outbox = applyDeliveryResult(outbox, "e-1", { status: 503 }, at(2_000));
  assert.equal(outbox.deadLetters[0]?.reason, "retry-exhausted");
});

test("non-retryable refusals are dead-lettered immediately, not retried forever", () => {
  for (const status of [400, 401, 403, 409, 413, 415, 422]) {
    const outbox = applyDeliveryResult(enqueue(createOutbox(), event("e-1"), t0), "e-1", { status }, t0);
    assert.equal(outbox.pending.length, 0, String(status));
    assert.equal(outbox.deadLetters[0].reason, "rejected");
    assert.equal(outbox.deadLetters[0].lastError, "http:" + status);
  }
});

test("acknowledged, replayed and suppressed deliveries all clear the outbox", async () => {
  for (const status of [200, 201, 202]) {
    const outbox = await drain(enqueue(createOutbox(), event("e-1"), t0), async () => ({ status }), t0);
    assert.equal(outbox.pending.length, 0);
    assert.equal(outbox.delivered[0].status, status);
    assert.equal(reportingGate("failed", outbox, { mandatory: true }).reportingGate, "passed");
  }
});

test("the outbox is bounded, deduplicated and refuses Vitium echoes visibly", () => {
  let outbox = createOutbox({ capacity: 2 });
  outbox = enqueue(outbox, event("e-1"), t0);
  outbox = enqueue(outbox, event("e-1"), t0);
  outbox = enqueue(outbox, event("e-2"), t0);
  outbox = enqueue(outbox, event("e-3"), t0);
  outbox = enqueue(outbox, event("e-4", { correlation: { causationEventId: "vitium:update-1" } }), t0);
  assert.deepEqual(outbox.pending.map(x => x.eventId), ["e-1", "e-2"]);
  assert.deepEqual(outbox.refused.map(x => [x.eventId, x.reason]), [["e-3", "outbox-full"], ["e-4", "vitium-echo"]]);
  assert.equal(reportingGate("passed", outbox).reporting, "failed", "dropping an event is never silent");
});

test("outbox values are immutable", () => {
  const empty = createOutbox();
  const next = enqueue(empty, event("e-1"), t0);
  assert.equal(empty.pending.length, 0);
  assert.throws(() => { next.pending.push({}); }, TypeError);
});
