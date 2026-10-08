// Typed machine-intake failures (VIT-INT-013/015/016). Separate from the public intake
// catalogue (service/errors.mjs) on purpose: the audiences, trust model and wire contract
// differ. Messages are producer-safe: they never echo body content, principal claims or
// infrastructure detail. `path` (a JSON path into the envelope) is included only for
// validation failures, so a producer can fix its adapter.
//
// HTTP statuses are the PROPOSED mapping for a future authenticated endpoint; no route exists.

export const ok = value => Object.freeze({ ok: true, value });
export const fail = error => Object.freeze({ ok: false, error });

const catalog = Object.freeze({
  payload_too_large:         { category: "validation", status: 413, retryable: false, message: "The observation is too large." },
  invalid_json:              { category: "validation", status: 400, retryable: false, message: "The observation must be valid JSON." },
  invalid_envelope:          { category: "validation", status: 400, retryable: false, message: "The observation does not match the envelope schema." },
  unsupported_version:       { category: "validation", status: 400, retryable: false, message: "Unsupported envelope schemaVersion." },
  credential_in_body:        { category: "validation", status: 400, retryable: false, message: "Credentials must never be sent in the observation body." },
  unsafe_evidence:           { category: "validation", status: 400, retryable: false, message: "Evidence references must be credential-free https links with digests." },
  log_dump_refused:          { category: "validation", status: 400, retryable: false, message: "Send a redacted summary and an evidence reference, not log or stack-trace content." },
  unauthenticated:           { category: "auth",       status: 401, retryable: false, message: "A valid workload credential is required." },
  invalid_principal:         { category: "auth",       status: 401, retryable: false, message: "A valid workload credential is required." },
  principal_expired:         { category: "auth",       status: 401, retryable: true,  message: "The workload credential has expired; obtain a fresh one." },
  identity_mismatch:         { category: "auth",       status: 403, retryable: false, message: "The claimed source does not match the authenticated workload." },
  repository_not_in_scope:   { category: "auth",       status: 403, retryable: false, message: "The workload is not authorized for this repository." },
  environment_not_in_scope:  { category: "auth",       status: 403, retryable: false, message: "The workload is not authorized for this environment." },
  event_type_not_in_scope:   { category: "auth",       status: 403, retryable: false, message: "The workload is not authorized for this event type." },
  spoofed_echo_marker:       { category: "auth",       status: 403, retryable: false, message: "Only Vitium itself may send events carrying a Vitium origin marker." },
  event_conflict:           { category: "conflict",   status: 409, retryable: false, message: "This eventId was already used for different content." },
  stale_event:               { category: "conflict",   status: 409, retryable: false, message: "A newer event for this verification attempt is already recorded." },
  attempt_conflict:          { category: "conflict",   status: 409, retryable: false, message: "This verification attempt already has a recorded result." },
  causation_unknown:         { category: "ordering",   status: 409, retryable: true,  message: "The causing event has not been recorded yet; retry later." },
  throttled:                 { category: "throttled",  status: 429, retryable: true,  message: "Too many observations; retry with backoff." },
  authentication_unavailable:{ category: "temporary",  status: 503, retryable: true,  message: "Identity verification is temporarily unavailable." },
  storage_unavailable:       { category: "temporary",  status: 503, retryable: true,  message: "The observation could not be recorded; retry with backoff." }
});

export const MACHINE_ERROR_CODES = Object.freeze(Object.keys(catalog));

/** Typed failure. Unknown codes collapse to storage_unavailable (fail closed, retryable). */
export function machineFailure(code, path) {
  const known = typeof code === "string" && Object.hasOwn(catalog, code) ? code : "storage_unavailable";
  const entry = catalog[known];
  return Object.freeze({
    code: known, category: entry.category, status: entry.status, retryable: entry.retryable, message: entry.message,
    ...(entry.category === "validation" && typeof path === "string" ? { path } : {})
  });
}
