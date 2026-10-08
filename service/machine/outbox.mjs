// Producer-side outbox policy (VIT-INT-015, VIT-AC-035). Pure functions only: a future
// shared producer binding (Praxis, CI/Dokimos, ...) persists entries and performs HTTP
// itself; these functions decide what happens next. No timers, no I/O, no randomness
// (jitter is an injected number in [0,1)).
//
// Invariant: the producer's own build/test result is an immutable INPUT. Delivery outcome
// is reported beside it as separate telemetry (and, if repository policy makes reporting
// mandatory, as a SEPARATE gate) and never overwrites it.

const ok = value => Object.freeze({ ok: true, value });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const ms = iso => Date.parse(iso);
const iso = n => new Date(n).toISOString();

// Provisional engineering defaults (not an SLA; see MACH-001 open decisions).
export const DEFAULT_POLICY = Object.freeze({
  baseDelayMs: 2000,
  maxDelayMs: 300000,
  maxAttempts: 8,
  expiresAfterMs: 86400000, // the event is dead-lettered (never silently dropped) after this
  maxRetryAfterMs: 600000
});

export function checkPolicy(p) {
  const pos = n => Number.isSafeInteger(n) && n > 0;
  if (!isObject(p) || !pos(p.baseDelayMs) || !pos(p.maxDelayMs) || !pos(p.maxAttempts) || !pos(p.expiresAfterMs) || !pos(p.maxRetryAfterMs) || p.baseDelayMs > p.maxDelayMs) {
    return fail("invalid_policy", "Outbox policy must have positive bounded integers.");
  }
  return ok(Object.freeze({ ...p }));
}

const PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/+@-]{0,127}$/;
const isPrincipalId = v => typeof v === "string" && PRINCIPAL_ID.test(v);

/**
 * Producer API (VF-036): create an outbox entry. Total; returns Result<entry>.
 * The producer's own workload principalId is REQUIRED: an ack can only prove delivery when
 * it names the principal that sent the event, so an entry without one could never be
 * confirmed. Refusals: missing_principal | invalid_entry.
 */
export function createOutboxEntry(envelope, now, principalId) {
  if (!isObject(envelope) || typeof envelope.eventId !== "string" || !envelope.eventId) return fail("invalid_entry", "An envelope with an eventId is required.");
  if (typeof now !== "string" || !Number.isFinite(ms(now))) return fail("invalid_entry", "now must be an ISO-8601 instant.");
  if (!isPrincipalId(principalId)) return fail("missing_principal", "The producer's workload principalId is required to verify delivery acks.");
  return ok(Object.freeze({ eventId: envelope.eventId, principalId, envelope, createdAt: now, attempts: 0, nextAttemptAt: now, status: "pending", lastError: null }));
}

/**
 * Compatibility constructor that returns the entry directly (existing callers and tests).
 * Without a valid principalId the entry is still retried and expired normally, but it is
 * marked `principalId: null` and can NEVER be marked delivered: the first 2xx dead-letters
 * it with reason "missing-principal" (fail closed, visible). New code uses createOutboxEntry.
 */
export function enqueue(envelope, now, principalId = undefined) {
  return Object.freeze({
    eventId: envelope.eventId, principalId: isPrincipalId(principalId) ? principalId : null,
    envelope, createdAt: now, attempts: 0, nextAttemptAt: now, status: "pending", lastError: null
  });
}

/**
 * Classify one delivery outcome.
 *   outcome: {kind:"response", status, retryAfterMs?, body?} | {kind:"timeout"} | {kind:"network-error"}
 *   expected: {eventId, principalId} of the entry being delivered
 * -> "delivered" | "retry" | "reauthenticate" | "permanent" | "unverifiable"
 * A 2xx counts as delivered ONLY when the body is a machine ack for exactly this eventId AND
 * this principal with status "recorded" (VF-033, VF-036: the principal is ALWAYS compared;
 * an unknown expected principal matches nothing). Other 2xx bodies (captive portal, proxy
 * page, another event's or principal's ack, {}) are a retryable protocol error. A 2xx for
 * an entry with no principal is "unverifiable": it can never be confirmed, so it is final.
 */
export function isAckFor(body, expected) {
  return isObject(body) && isObject(expected) && isPrincipalId(expected.principalId)
    && body.schemaVersion === "1.0" && body.status === "recorded"
    && typeof body.eventId === "string" && body.eventId === expected.eventId
    && typeof body.observationId === "string" && typeof body.receivedAt === "string" && typeof body.replayed === "boolean"
    && typeof body.principalId === "string" && body.principalId === expected.principalId;
}
export function classifyDelivery(outcome, expected) {
  if (!isObject(outcome)) return "retry";
  if (outcome.kind === "timeout" || outcome.kind === "network-error") return "retry";
  if (outcome.kind !== "response" || !Number.isSafeInteger(outcome.status)) return "retry";
  const s = outcome.status;
  if (s >= 200 && s < 300) {
    if (!isObject(expected) || !isPrincipalId(expected.principalId)) return "unverifiable";
    return isAckFor(outcome.body, expected) ? "delivered" : "retry";
  }
  if (s === 429 || s === 408 || s >= 500) return "retry";
  if (s === 401 && outcome.body?.code === "principal_expired") return "reauthenticate";
  // 409 event_conflict / stale_event / attempt_conflict, 400s, 401/403 scope failures:
  // retrying the same bytes cannot succeed; dead-letter for repair.
  if (s === 409 && outcome.body?.code === "causation_unknown") return "retry";
  return "permanent";
}

const backoff = (attempts, policy, jitter) => {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempts - 1));
  const j = Number.isFinite(jitter) && jitter >= 0 && jitter < 1 ? jitter : 0;
  return Math.min(policy.maxDelayMs, Math.round(exp / 2 + (exp / 2) * j)); // "equal jitter", bounded
};

/**
 * nextDelivery(entry, now, policy, outcome?, jitter?) -> Result<entry'>
 * Pure. Without an outcome it answers whether the entry is due / expired. With an outcome it
 * records the attempt. Terminal statuses: delivered, dead-letter (with reason).
 */
export function nextDelivery(entry, now, policy = DEFAULT_POLICY, outcome = undefined, jitter = 0) {
  const p = checkPolicy(policy);
  if (!p.ok) return p;
  if (!isObject(entry) || typeof entry.createdAt !== "string" || !Number.isSafeInteger(entry.attempts)) return fail("invalid_entry", "Malformed outbox entry.");
  if (entry.status === "delivered" || entry.status === "dead-letter") return ok(entry);
  const nowMs = ms(now);
  if (!Number.isFinite(nowMs)) return fail("invalid_time", "now must be an ISO-8601 instant.");
  const expired = nowMs - ms(entry.createdAt) >= p.value.expiresAfterMs;
  const dead = (reason, lastError, attempts = entry.attempts) => ok(Object.freeze({ ...entry, attempts, status: "dead-letter", deadLetterReason: reason, lastError, nextAttemptAt: null }));
  if (outcome === undefined) {
    if (expired) return dead("expired", entry.lastError);
    return ok(Object.freeze({ ...entry, due: nowMs >= ms(entry.nextAttemptAt) }));
  }
  const attempts = entry.attempts + 1;
  const verdict = classifyDelivery(outcome, { eventId: entry.eventId, principalId: entry.principalId });
  const unacknowledged2xx = verdict !== "delivered" && outcome?.kind === "response" && outcome.status >= 200 && outcome.status < 300;
  const lastError = verdict === "delivered" ? null : Object.freeze({
    kind: unacknowledged2xx ? "protocol-error" : outcome?.kind ?? "unknown", status: outcome?.status ?? null,
    code: verdict === "unverifiable" ? "missing_principal" : unacknowledged2xx ? "ack_mismatch" : typeof outcome?.body?.code === "string" ? outcome.body.code : null
  });
  if (verdict === "delivered") return ok(Object.freeze({ ...entry, attempts, status: "delivered", lastError: null, nextAttemptAt: null, deliveredAt: now }));
  if (verdict === "unverifiable") return dead("missing-principal", lastError, attempts);
  if (verdict === "permanent") return dead("permanent-refusal", lastError, attempts);
  if (verdict === "reauthenticate") {
    if (attempts >= p.value.maxAttempts) return dead("retry-exhausted", lastError, attempts);
    return ok(Object.freeze({ ...entry, attempts, status: "needs-credential", lastError, nextAttemptAt: now }));
  }
  if (attempts >= p.value.maxAttempts) return dead("retry-exhausted", lastError, attempts);
  if (expired) return dead("expired", lastError, attempts);
  const retryAfter = Number.isSafeInteger(outcome?.retryAfterMs) && outcome.retryAfterMs > 0 ? Math.min(outcome.retryAfterMs, p.value.maxRetryAfterMs) : 0;
  const delay = Math.max(backoff(attempts, p.value, jitter), retryAfter);
  return ok(Object.freeze({ ...entry, attempts, status: "pending", lastError, nextAttemptAt: iso(nowMs + delay) }));
}

/**
 * Producer build report: the build result is returned untouched (same object identity, frozen
 * by the caller) beside separate delivery telemetry. A mandatory-reporting policy yields a
 * separate gate, never a changed test status.
 */
export function reportWithDelivery(buildResult, entries, { reportingMandatory = false } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const undelivered = list.filter(e => e.status !== "delivered");
  const delivery = Object.freeze({
    total: list.length,
    delivered: list.length - undelivered.length,
    pending: undelivered.filter(e => e.status === "pending" || e.status === "needs-credential").length,
    deadLettered: undelivered.filter(e => e.status === "dead-letter").length,
    failures: Object.freeze(undelivered.map(e => Object.freeze({ eventId: e.eventId, status: e.status, reason: e.deadLetterReason ?? null, lastError: e.lastError ?? null })))
  });
  const gates = reportingMandatory
    ? Object.freeze([Object.freeze({ gate: "vitium-reporting", passed: undelivered.length === 0 })])
    : Object.freeze([]);
  return Object.freeze({ buildResult, delivery, gates });
}

/**
 * Deterministic delivery order: an event is never sent before the event it is caused by
 * (correlation.causationEventId). Independent events keep observedAt then eventId order.
 * An event whose cause is not in this batch (already delivered earlier) is not blocked.
 * Events in a causation cycle can never be ordered: they are withheld from `ordered` and
 * listed in `cyclic` for dead-letter repair.
 */
export function orderByCausation(envelopes) {
  const list = [...envelopes].sort((a, b) => (ms(a.observedAt) - ms(b.observedAt)) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  const ids = new Set(list.map(e => e.eventId));
  const emitted = new Set();
  const ordered = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const e of list) {
      if (emitted.has(e.eventId)) continue;
      const cause = e.correlation?.causationEventId ?? null;
      if (cause === null || !ids.has(cause) || emitted.has(cause)) { ordered.push(e); emitted.add(e.eventId); progressed = true; }
    }
  }
  const blocked = list.filter(e => !emitted.has(e.eventId));
  return Object.freeze({ ordered: Object.freeze(ordered), cyclic: Object.freeze(blocked.map(e => e.eventId)) });
}
