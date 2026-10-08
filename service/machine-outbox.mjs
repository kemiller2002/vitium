// Reference producer adapter: bounded outbox with retry/backoff/expiry (VIT-INT-015).
// Pure state transitions over an immutable outbox value plus one injected-effect driver.
// The producer's own build/test outcome is never changed by reporting; delivery problems
// surface as a separate reporting gate (VIT-AC-035). Not distributed via Conditor yet.
import { isVitiumEcho } from "./machine-observation.mjs";

export const defaultOutboxPolicy = Object.freeze({
  capacity: 100, maxAttempts: 6, ttlMs: 24 * 3600_000, baseDelayMs: 2_000, maxDelayMs: 15 * 60_000
});
const delivered = new Set([200, 201, 202]);
const retryable = new Set([408, 425, 429, 500, 502, 503, 504]);

const positive = value => Number.isSafeInteger(value) && value > 0;
function resolveOutboxPolicy(policy) {
  const merged = { ...defaultOutboxPolicy, ...Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) };
  if (!Object.keys(defaultOutboxPolicy).every(key => positive(merged[key])) || merged.baseDelayMs > merged.maxDelayMs) {
    throw new TypeError("Outbox policy values must be bounded positive integers.");
  }
  return Object.freeze(merged);
}
export const createOutbox = (policy = {}) => Object.freeze({
  policy: resolveOutboxPolicy(policy),
  pending: Object.freeze([]),
  delivered: Object.freeze([]),
  deadLetters: Object.freeze([]),
  refused: Object.freeze([])
});
const withChanges = (outbox, changes) => Object.freeze({ ...outbox, ...changes });
const append = (list, item) => Object.freeze([...list, Object.freeze(item)]);
const refuseEntry = (outbox, eventId, reason, at) => withChanges(outbox, { refused: append(outbox.refused, { eventId, reason, at }) });

/** Adds an envelope unless it is a Vitium echo, a duplicate, or the outbox is full (recorded, not hidden). */
export function enqueue(outbox, envelope, now) {
  const eventId = envelope?.eventId;
  if (typeof eventId !== "string" || !eventId) return refuseEntry(outbox, null, "missing-event-id", now);
  if (isVitiumEcho(envelope)) return refuseEntry(outbox, eventId, "vitium-echo", now);
  const known = [...outbox.pending, ...outbox.delivered, ...outbox.deadLetters].some(entry => entry.eventId === eventId);
  if (known) return outbox;
  if (outbox.pending.length >= outbox.policy.capacity) return refuseEntry(outbox, eventId, "outbox-full", now);
  const createdAt = Date.parse(now);
  return withChanges(outbox, {
    pending: append(outbox.pending, {
      eventId, envelope, attempts: 0, nextAttemptAt: now,
      expiresAt: new Date(createdAt + outbox.policy.ttlMs).toISOString(), lastError: null
    })
  });
}

export const due = (outbox, now) => outbox.pending.filter(entry => Date.parse(entry.nextAttemptAt) <= Date.parse(now));

// A malformed Retry-After from the server never crashes the producer; it falls back to backoff.
const safeRetryAfter = value => Number.isFinite(value) && value > 0 ? value : 0;
export const backoffMs = (policy, attempts, retryAfterMs) =>
  Math.min(policy.maxDelayMs, Math.max(safeRetryAfter(retryAfterMs), policy.baseDelayMs * 2 ** Math.max(0, attempts - 1)));

/** Applies one delivery result: {status} from HTTP, or {error} for a transport failure. */
export function applyDeliveryResult(outbox, eventId, result, now) {
  const entry = outbox.pending.find(item => item.eventId === eventId);
  if (!entry) return outbox;
  const rest = Object.freeze(outbox.pending.filter(item => item.eventId !== eventId));
  const attempts = entry.attempts + 1;
  if (delivered.has(result.status)) {
    return withChanges(outbox, { pending: rest, delivered: append(outbox.delivered, { eventId, attempts, deliveredAt: now, status: result.status }) });
  }
  const lastError = result.error ? "transport:" + String(result.error).slice(0, 200) : "http:" + result.status;
  const transient = Boolean(result.error) || retryable.has(result.status);
  const nextAttemptAt = new Date(Date.parse(now) + backoffMs(outbox.policy, attempts, result.retryAfterMs)).toISOString();
  const exhausted = attempts >= outbox.policy.maxAttempts || Date.parse(nextAttemptAt) > Date.parse(entry.expiresAt);
  if (!transient || exhausted) {
    return withChanges(outbox, {
      pending: rest,
      deadLetters: append(outbox.deadLetters, { eventId, envelope: entry.envelope, attempts, lastError, reason: transient ? "retry-exhausted" : "rejected", at: now })
    });
  }
  return withChanges(outbox, { pending: Object.freeze([...rest, Object.freeze({ ...entry, attempts, lastError, nextAttemptAt })]) });
}

/** Drives due deliveries through an injected `send(envelope) -> Promise<{status, retryAfterMs?}>`. */
export async function drain(outbox, send, now) {
  const results = await Promise.all(due(outbox, now).map(entry =>
    Promise.resolve().then(() => send(entry.envelope))
      .then(result => ({ eventId: entry.eventId, result: result ?? { error: "empty response" } }))
      .catch(error => ({ eventId: entry.eventId, result: { error: error?.message || "delivery failed" } }))
  ));
  return results.reduce((state, { eventId, result }) => applyDeliveryResult(state, eventId, result, now), outbox);
}

/**
 * Reporting status beside, never instead of, the producer's own result. A repository that
 * makes reporting mandatory fails the separate reporting gate, while buildOutcome is preserved.
 */
export function reportingGate(buildOutcome, outbox, { mandatory = false } = {}) {
  const dropped = outbox.refused.filter(entry => entry.reason !== "vitium-echo");
  const undelivered = Object.freeze([...outbox.pending, ...outbox.deadLetters, ...dropped].map(entry => entry.eventId));
  const failed = outbox.deadLetters.length > 0 || dropped.length > 0;
  const reporting = failed ? "failed" : outbox.pending.length > 0 ? "pending" : "delivered";
  return Object.freeze({
    buildOutcome,
    reporting,
    reportingGate: mandatory && reporting !== "delivered" ? "failed" : "passed",
    undelivered,
    deadLetters: Object.freeze(outbox.deadLetters.map(({ eventId, attempts, lastError, reason }) => Object.freeze({ eventId, attempts, lastError, reason })))
  });
}
