// Reference in-memory adapter for the machine-observation store port (tests and contract
// examples only; NOT a deployed store). State lives in this closure, i.e. at the effect
// boundary; the core never sees it. Semantics mirror the intake DynamoDB adapter:
// putOnce is a conditional put on pk (eventId) AND, when present, on attemptKey (a
// transactional uniqueness item in a real table).
//
// `faults` lets tests inject failures: {put?: "unavailable"|"throttled"|"throw", lookup?: ...}.
const ok = value => Object.freeze({ ok: true, value });
const fail = error => Object.freeze({ ok: false, error });

export function makeMemoryStore({ faults = {} } = {}) {
  const items = new Map();      // pk -> record
  const attempts = new Map();   // attemptKey -> pk
  const injected = kind => {
    const f = typeof faults === "function" ? faults(kind) : faults[kind];
    if (f === "throw") throw new Error("injected " + kind + " failure");
    return f ? fail(f) : null;
  };
  return Object.freeze({
    async putOnce(record) {
      const f = injected("put");
      if (f) return f;
      const existing = items.get(record.pk);
      if (existing) return ok({ created: false, existing: { eventId: existing.eventId, canonicalHash: existing.canonicalHash, observationId: existing.observationId, receivedAt: existing.receivedAt } });
      if (record.attemptKey && attempts.has(record.attemptKey)) {
        const holder = items.get(attempts.get(record.attemptKey));
        return ok({ created: false, attemptTaken: { eventId: holder.eventId, eventType: holder.eventType, observedAt: holder.observedAt } });
      }
      items.set(record.pk, record);
      if (record.attemptKey) attempts.set(record.attemptKey, record.pk);
      return ok({ created: true });
    },
    async lookupEvent(eventId) {
      const f = injected("lookup");
      if (f) return f;
      return ok({ found: items.has("MEVENT#" + eventId) });
    },
    /** Test inspection only. */
    records: () => Object.freeze([...items.values()]),
    byFingerprint: fp => Object.freeze([...items.values()].filter(r => r.candidate.fingerprint === fp))
  });
}
