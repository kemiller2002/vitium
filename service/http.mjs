// Thin HTTP adapter (API Gateway HTTP API payload v2 / REST v1 event shapes).
// Order: origin -> route -> content type -> byte limit (before decode/parse) -> JSON parse
// -> intake core -> typed response. Never throws; never echoes reporter content; logs only
// the allow-listed record from adapters/safe-log.mjs through an injected logger.
import { intakeFailure, failureBody } from "./errors.mjs";
import { intakeLogRecord } from "./adapters/safe-log.mjs";

export const MAX_BODY_BYTES = 16_384;
export const ROUTE = "/api/v1/reports";
// Upper bound on the base64 text for MAX_BODY_BYTES, checked before decoding.
const MAX_BASE64_CHARS = Math.ceil(MAX_BODY_BYTES / 3) * 4;

function response(status, data, origin, requestId) {
  return {
    statusCode: status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff",
      "referrer-policy":"no-referrer",
      "content-security-policy":"default-src 'none'; frame-ancestors 'none'",
      "vary":"Origin",
      ...(origin ? {"access-control-allow-origin":origin} : {}),
      ...(requestId ? {"x-request-id":requestId} : {})
    },
    body: JSON.stringify(data)
  };
}
const header = (headers, key) => Object.entries(headers || {}).find(([k]) => k.toLowerCase() === key)?.[1];
const safeRequestId = value => typeof value === "string" && /^[A-Za-z0-9=_.-]{1,128}$/.test(value) ? value : undefined;

/** Pure: event -> Result<{body}> for everything that can be decided without effects. */
export function readRequest(event, allowedOrigin) {
  const origin = header(event.headers, "origin");
  if (origin !== allowedOrigin) return {ok:false, error:intakeFailure("origin_denied"), cors:false};
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path;
  if (method !== "POST" || path !== ROUTE) return {ok:false, error:intakeFailure("not_found"), cors:true};
  const contentType = header(event.headers, "content-type") || "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return {ok:false, error:intakeFailure("invalid_content_type"), cors:true};
  const raw = event.body;
  if (typeof raw !== "string") return {ok:false, error:intakeFailure("invalid_json"), cors:true};
  if (event.isBase64Encoded ? raw.length > MAX_BASE64_CHARS : raw.length > MAX_BODY_BYTES) {
    return {ok:false, error:intakeFailure("payload_too_large"), cors:true};
  }
  const input = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(input, "utf8") > MAX_BODY_BYTES) return {ok:false, error:intakeFailure("payload_too_large"), cors:true};
  let body;
  try { body = JSON.parse(input); } catch { return {ok:false, error:intakeFailure("invalid_json"), cors:true}; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {ok:false, error:intakeFailure("invalid_input","Report must be an object."), cors:true};
  return {ok:true, value:{body, idempotencyKey: header(event.headers, "idempotency-key")}};
}

export function createHttpHandler(intake, {allowedOrigin = "https://vitium.echelonfoundry.com", log = () => {}} = {}) {
  const emit = record => { try { log(intakeLogRecord(record)); } catch { /* logging must never change the outcome */ } };
  return async function handle(event = {}) {
    const requestId = safeRequestId(event.requestContext?.requestId);
    const request = readRequest(event, allowedOrigin);
    if (!request.ok) {
      const {error} = request;
      emit({requestId, status:error.status, code:error.code, category:error.category});
      return response(error.status, failureBody(error), request.cors ? allowedOrigin : null, requestId);
    }
    let result;
    try {
      const {body, idempotencyKey} = request.value;
      result = await intake.submit(body, {idempotencyKey, challengeToken: body.challengeToken});
    } catch {
      result = {ok:false, error:intakeFailure("service_unavailable")};
    }
    if (!result?.ok) {
      const error = result?.error?.code ? result.error : intakeFailure("service_unavailable");
      emit({requestId, status:error.status, code:error.code, category:error.category});
      return response(error.status, failureBody(error), allowedOrigin, requestId);
    }
    const receipt = result.value;
    const status = receipt.replayed ? 200 : 201;
    emit({requestId, status, code: receipt.replayed ? "replayed" : "accepted",
      disposition: receipt.disposition, flags: result.screening?.flags,
      redactions: result.screening?.redactions, replayed: receipt.replayed});
    return response(status, receipt, allowedOrigin, requestId);
  };
}
