// Structured, allow-listed intake log records (VIT-NFR-004, VIT-AC-015).
// A log record is built by a pure function from enumerated, non-sensitive facts only.
// There is deliberately no field that can carry report text, challenge tokens,
// idempotency keys, IP addresses, user agents, origins or provider/infrastructure errors.

const SAFE_TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
const safe = value => typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
const safeList = list => Array.isArray(list) ? list.map(safe).filter(Boolean).slice(0, 16) : [];

/** Pure: build the only shape the intake ever logs. */
export function intakeLogRecord({requestId, status, code, category, disposition, flags, redactions, replayed}) {
  return Object.freeze({
    event: "vitium.intake",
    requestId: safe(requestId),
    status: Number.isInteger(status) ? status : undefined,
    code: safe(code),
    category: safe(category),
    disposition: safe(disposition),
    flags: safeList(flags),
    redactions: safeList(redactions),
    replayed: typeof replayed === "boolean" ? replayed : undefined
  });
}

/** Effect adapter: write one JSON line. `write` is injected (console.log in Lambda). */
export const makeJsonLogger = write => record => write(JSON.stringify(record));
