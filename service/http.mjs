import { IntakeError } from "./report-domain.mjs";

function response(status, data, origin, requestId) {
  return {
    statusCode: status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff",
      "vary":"Origin",
      ...(origin ? {"access-control-allow-origin":origin} : {}),
      ...(requestId ? {"x-request-id":requestId} : {})
    },
    body: JSON.stringify(data)
  };
}
const header = (headers, key) => Object.entries(headers || {}).find(([k]) => k.toLowerCase() === key)?.[1];
export function createHttpHandler(intake, {allowedOrigin = "https://vitium.echelonfoundry.com"} = {}) {
  return async function handle(event = {}) {
    const origin = header(event.headers, "origin");
    const safeOrigin = origin === allowedOrigin ? origin : null;
    const requestId = event.requestContext?.requestId;
    if (origin !== allowedOrigin) return response(403,{code:"origin_denied",message:"This origin is not allowed."},null,requestId);
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path;
    if (method !== "POST" || path !== "/api/v1/reports") {
      return response(404,{code:"not_found",message:"This operation is unavailable."},safeOrigin,requestId);
    }
    const contentType = header(event.headers,"content-type") || "";
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
      return response(415,{code:"invalid_content_type",message:"Send JSON."},safeOrigin,requestId);
    }
    try {
      const input = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body;
      if (typeof input !== "string" || Buffer.byteLength(input,"utf8") > 16_384) {
        return response(413,{code:"payload_too_large",message:"The report is too large."},safeOrigin,requestId);
      }
      let body;
      try { body=JSON.parse(input); }
      catch { return response(400,{code:"invalid_json",message:"The report must contain valid JSON."},safeOrigin,requestId); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return response(400,{code:"invalid_input",message:"Report must be an object."},safeOrigin,requestId);
      }
      const challengeToken = body.challengeToken;
      const result = await intake.submit(body,{
        idempotencyKey: header(event.headers,"idempotency-key"),
        challengeToken
      });
      return response(result.replayed?200:201, result, safeOrigin,requestId);
    } catch (error) {
      if (error instanceof IntakeError) return response(error.status,{code:error.code,message:error.message},safeOrigin,requestId);
      return response(503,{code:"service_unavailable",message:"The service is unavailable. Please retry."},safeOrigin,requestId);
    }
  };
}
