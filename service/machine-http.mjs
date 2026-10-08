// HTTP boundary for authenticated machine events: POST /api/v1/observations and
// POST /api/v1/verification-results (the routes used by EchelonFoundry.Vitium.Client).
// Deliberately not wired into infra/aws/template.yaml: no machine endpoint is deployed.
// Machine clients send no Origin; browser-originated requests are refused and no CORS
// headers are emitted, so this route cannot be driven from the public reporting page.
import { MachineIntakeError } from "./machine-intake.mjs";
import { limits } from "./machine-observation.mjs";

const response = (statusCode, data, requestId) => Object.freeze({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(requestId ? { "x-request-id": requestId } : {})
  },
  body: JSON.stringify(data)
});
const header = (headers, key) => Object.entries(headers || {}).find(([name]) => name.toLowerCase() === key)?.[1];
const statusFor = result => result.status === "suppressed" ? 202 : result.replayed ? 200 : 201;

export function createMachineHttpHandler(machineIntake) {
  return async function handle(event = {}) {
    const requestId = event.requestContext?.requestId;
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path;
    const submit = { "/api/v1/observations": "submit", "/api/v1/verification-results": "submitVerificationResult" }[path];
    if (method !== "POST" || !submit) {
      return response(404, { code: "not_found", message: "This operation is unavailable." }, requestId);
    }
    if (header(event.headers, "origin") !== undefined) {
      return response(403, { code: "browser_origin_denied", message: "Machine intake does not accept browser requests." }, requestId);
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(event.headers, "content-type") || "")) {
      return response(415, { code: "invalid_content_type", message: "Send JSON." }, requestId);
    }
    const input = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body;
    if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > limits.maxBytes) {
      return response(413, { code: "payload_too_large", message: "The observation is too large." }, requestId);
    }
    let body;
    try { body = JSON.parse(input); }
    catch { return response(400, { code: "invalid_json", message: "The observation must be valid JSON." }, requestId); }
    try {
      const result = await machineIntake[submit](body, {
        authorization: header(event.headers, "authorization"),
        idempotencyKey: header(event.headers, "idempotency-key")
      });
      return response(statusFor(result), result, requestId);
    } catch (error) {
      if (error instanceof MachineIntakeError) return response(error.status, { code: error.code, message: error.message }, requestId);
      return response(503, { code: "service_unavailable", message: "The service is unavailable. Retry later." }, requestId);
    }
  };
}
