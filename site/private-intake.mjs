// Private intake client contract (VIT-API-001 client side, VIT-UX-004/005/007).
//
// Pure functions only, except makeHttpPerformer, which is the single effect
// adapter and receives fetch/timers/online-state as parameters. Nothing here
// holds credentials: the only values sent are the reporter's report, a public
// one-time challenge token and a random idempotency key. Report text never
// enters a URL.
//
// Limits mirror service/report-domain.mjs and service/http.mjs. They are NOT
// imported from service/ at runtime (the site is static). tests/site-intake-contract.test.mjs
// compares them behaviourally against the server so drift fails CI.
import { validateReport, FIELD_ORDER } from "./submission.mjs";

export const INTAKE_ENDPOINT = "https://intake.vitium.echelonfoundry.com/api/v1/reports";
export const SCHEMA_VERSION = "1.0";
export const REQUEST_TIMEOUT_MS = 15000;
export const PRIVATE_LIMITS = Object.freeze({
  product: 100, impact: 100, title: 120, actual: 1200, expected: 1200, steps: 900, pageUrl: 2000,
  bodyBytes: 16384, challengeTokenMin: 12, challengeTokenMax: 4096
});
export const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "product", "impact", "title", "actual", "expected", "steps", "pageUrl",
  "privacyAcknowledged", "challengeToken"
]);
export const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TURNSTILE_SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{10,120}$/;
export const REFERENCE_PATTERN = /^VIT-[A-Za-z0-9-]{8,64}$/;
// Mirrors the server's control-character and obvious-credential guardrails so the
// reporter is told before transmission. The server remains the authority.
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
export const CREDENTIAL_PATTERN = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{15,}|sk-[A-Za-z0-9_-]{18,}|(?:password|api[_ -]?key)\s*[:=]\s*\S{4,})/i;

const ok = value => ({ ok: true, value });
const fail = error => ({ ok: false, error });
const fieldError = (field, code, message) => Object.freeze({ field, code, message });

/** Fail-closed channel selection. Anything short of a complete approved config is "github". */
export function resolveChannel(config) {
  const c = config && typeof config === "object" ? config : {};
  return c.enabled === true &&
    c.endpoint === INTAKE_ENDPOINT &&
    typeof c.turnstileSiteKey === "string" &&
    TURNSTILE_SITE_KEY_PATTERN.test(c.turnstileSiteKey)
    ? "private" : "github";
}

/** Legacy validation plus the server's additional private-intake rules. Never throws. */
export function validatePrivateReport(values) {
  const base = validateReport(values);
  if (!base.ok) return base;
  const report = base.value;
  const errors = [];
  for (const field of ["title", "actual", "expected", "steps"]) {
    if (CONTROL_CHARACTERS.test(report[field])) {
      errors.push(fieldError(field, "control_characters", "Remove unusual control characters from this answer."));
    }
  }
  const narrative = ["title", "actual", "expected", "steps"].find(f => CREDENTIAL_PATTERN.test(report[f]));
  if (narrative) {
    errors.push(fieldError(narrative, "credential",
      "This looks like a password, key or access token. Remove it before sending."));
  }
  if (errors.length) {
    const order = f => FIELD_ORDER.indexOf(f);
    return { ok: false, errors: Object.freeze(errors.sort((a, b) => order(a.field) - order(b.field))) };
  }
  return ok(Object.freeze({ schemaVersion: SCHEMA_VERSION, ...report }));
}

const utf8Length = value => new TextEncoder().encode(value).length;

/** Validates an endpoint: exact approved HTTPS URL, no credentials, query or fragment. */
export function checkEndpoint(endpoint) {
  if (endpoint !== INTAKE_ENDPOINT) return fail(fieldError(null, "endpoint_not_approved", "Private reporting is not available."));
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    return fail(fieldError(null, "endpoint_not_approved", "Private reporting is not available."));
  }
  return ok(endpoint);
}

/**
 * Builds the typed HTTP effect (shape-compatible with Limen's HttpEffectRequest).
 * @returns {{ok:true,value:object}|{ok:false,error:object}}
 */
export function buildPrivateRequest({ report, idempotencyKey, challengeToken, endpoint = INTAKE_ENDPOINT, correlationId }) {
  const target = checkEndpoint(endpoint);
  if (!target.ok) return target;
  if (!report || report.schemaVersion !== SCHEMA_VERSION) {
    return fail(fieldError(null, "invalid_report", "Review your report before sending."));
  }
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return fail(fieldError(null, "invalid_request_id", "Review your report again before sending."));
  }
  if (typeof challengeToken !== "string" ||
      challengeToken.length < PRIVATE_LIMITS.challengeTokenMin ||
      challengeToken.length > PRIVATE_LIMITS.challengeTokenMax) {
    return fail(fieldError(null, "challenge_required", "Complete the verification before sending."));
  }
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    product: report.product, impact: report.impact, title: report.title,
    actual: report.actual, expected: report.expected, steps: report.steps, pageUrl: report.pageUrl,
    privacyAcknowledged: true,
    challengeToken
  };
  const body = JSON.stringify(payload);
  if (utf8Length(body) > PRIVATE_LIMITS.bodyBytes) {
    return fail(fieldError(null, "payload_too_large", "Your report is too long to send. Shorten the longest answers and try again."));
  }
  return ok(Object.freeze({
    kind: "Http",
    correlationId: correlationId ?? idempotencyKey,
    method: "POST",
    url: endpoint,
    headers: Object.freeze({ "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }),
    body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    response: "json",
    credentials: "omit"
  }));
}

// Each typed server error code maps to a client error kind and actionable copy.
// kind: validation | abuse | throttled | temporary | permanent | unavailable
// action: "edit" (change the report), "verify-retry" (redo challenge, same key),
//         "retry" (same key; safe), "start-new" (key invalid; edit then review again).
export const ERROR_CATALOGUE = Object.freeze({
  invalid_input: { kind: "validation", action: "edit", message: "The service could not accept part of your report. Check the details below, edit your report and send it again." },
  payload_too_large: { kind: "validation", action: "edit", message: "Your report is too long to send. Shorten the longest answers and send it again." },
  invalid_json: { kind: "permanent", action: "start-new", message: "Your report could not be read by the service. Edit and review it again." },
  invalid_content_type: { kind: "permanent", action: "start-new", message: "Your report could not be read by the service. Edit and review it again." },
  challenge_required: { kind: "abuse", action: "verify-retry", message: "Complete the verification again, then send your report." },
  challenge_failed: { kind: "abuse", action: "verify-retry", message: "Verification did not succeed. Complete it again, then send your report." },
  challenge_unavailable: { kind: "temporary", action: "verify-retry", message: "Verification is temporarily unavailable. Wait a moment, complete it again and resend. Your report has not been lost." },
  storage_unavailable: { kind: "temporary", action: "verify-retry", message: "The service could not save your report yet. Try sending again; it will not create a duplicate." },
  request_conflict: { kind: "permanent", action: "start-new", message: "This submission conflicts with an earlier one. Review your report again to start a new submission." },
  throttled: { kind: "throttled", action: "verify-retry", message: "Too many reports are being sent right now. Wait a few minutes, then try again. Your report is still here." },
  origin_denied: { kind: "permanent", action: "start-new", message: "Private reporting is not available from this page." },
  not_found: { kind: "unavailable", action: "verify-retry", message: "Private reporting is not available right now. Try again later." },
  service_unavailable: { kind: "unavailable", action: "verify-retry", message: "The reporting service is unavailable. Try again later; your report is still here." }
});

const receiptStatus = Object.freeze({ received: "accepted", quarantined: "under-review", "under-review": "under-review", under_review: "under-review" });

/** Validates an authoritative receipt. Returns null unless every field is present and well formed. */
export function parseReceipt(status, body) {
  if (!(status === 200 || status === 201)) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const kind = Object.hasOwn(receiptStatus, body.status) ? receiptStatus[body.status] : null;
  if (!kind) return null;
  if (typeof body.reference !== "string" || !REFERENCE_PATTERN.test(body.reference)) return null;
  if (typeof body.receivedAt !== "string" || Number.isNaN(Date.parse(body.receivedAt))) return null;
  return Object.freeze({ kind, reference: body.reference, receivedAt: body.receivedAt, replayed: body.replayed === true });
}

const safeDetail = message =>
  typeof message === "string" && message.length > 0 && message.length <= 300 && !CONTROL_CHARACTERS.test(message)
    ? message : null;

const rejection = (code, entry, extra = {}) => Object.freeze({
  kind: entry.kind, code, action: entry.action, message: entry.message,
  retryable: entry.action === "verify-retry" || entry.action === "retry",
  outcomeUnknown: false, detail: null, ...extra
});

const unknownOutcome = code => rejection(code, {
  kind: "temporary", action: "verify-retry",
  message: "We could not confirm whether your report arrived. Sending again is safe: it reuses the same request identifier, so it cannot create a duplicate."
}, { outcomeUnknown: true });

/**
 * Classifies a Limen-shaped EffectOutcome into accepted | under-review | rejected.
 * Accepted/under-review are returned ONLY with a valid server receipt.
 */
export function classifyOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return { kind: "rejected", error: unknownOutcome("invalid_outcome") };
  switch (outcome.kind) {
    case "Success": {
      const status = outcome.status;
      const receipt = parseReceipt(status, outcome.body);
      if (receipt) return { kind: receipt.kind, receipt };
      if (Number.isInteger(status) && status >= 200 && status < 300) {
        return { kind: "rejected", error: unknownOutcome("receipt_unconfirmed") };
      }
      const code = typeof outcome.body?.code === "string" ? outcome.body.code : null;
      if (code && Object.hasOwn(ERROR_CATALOGUE, code)) {
        const entry = ERROR_CATALOGUE[code];
        return { kind: "rejected", error: rejection(code, entry, entry.kind === "validation" ? { detail: safeDetail(outcome.body.message) } : {}) };
      }
      if (status === 429) return { kind: "rejected", error: rejection("throttled", ERROR_CATALOGUE.throttled) };
      if (status === 413) return { kind: "rejected", error: rejection("payload_too_large", ERROR_CATALOGUE.payload_too_large) };
      if (status === 408 || status >= 500) return { kind: "rejected", error: rejection("service_unavailable", ERROR_CATALOGUE.service_unavailable) };
      return { kind: "rejected", error: rejection("unexpected_response", {
        kind: "permanent", action: "start-new", message: "The service refused this report. Edit and review it again."
      }) };
    }
    case "Failure":
      if (outcome.reason === "network") {
        return { kind: "rejected", error: rejection("network", {
          kind: "unavailable", action: "verify-retry",
          message: "Your device could not reach the reporting service. Check your connection and try again. Your report is still here."
        }) };
      }
      return { kind: "rejected", error: unknownOutcome(outcome.reason === "aborted" ? "aborted" : "invalid_response") };
    case "Cancelled":
      return { kind: "rejected", error: unknownOutcome("cancelled") };
    case "OutcomeUnknown":
      return { kind: "rejected", error: unknownOutcome(outcome.reason === "connection-lost" ? "connection_lost" : "timeout") };
    default:
      return { kind: "rejected", error: unknownOutcome("invalid_outcome") };
  }
}

/**
 * The one effect adapter: performs a typed Http request and reports a Limen-shaped
 * EffectOutcome. All browser capabilities are injected.
 */
export function makeHttpPerformer({ fetchFn, setTimer, clearTimer, isOnline = () => true }) {
  return async function perform(request) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => { timedOut = true; controller.abort(); }, request.timeoutMs);
    try {
      const response = await fetchFn(request.url, {
        method: request.method, mode: "cors", credentials: request.credentials, cache: "no-store",
        redirect: "error", referrerPolicy: "no-referrer",
        headers: request.headers, body: request.body, signal: controller.signal
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { kind: "Success", status: response.status, body };
    } catch {
      if (timedOut) return { kind: "OutcomeUnknown", reason: "timeout-after-dispatch" };
      // A thrown POST while online may have reached the server (Limen protocol 1.4).
      if (isOnline()) return { kind: "OutcomeUnknown", reason: "connection-lost" };
      return { kind: "Failure", reason: "network" };
    } finally {
      clearTimer(timer);
    }
  };
}
