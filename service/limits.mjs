// Single source of truth for intake transport limits (fix round 1 contract).
// Consumed by service/http.mjs and service/intake.mjs; the site mirrors these values and
// tests/site-intake-contract.test.mjs imports this module to prove parity.
//
// maxBodyBytes: every field at its maximum in 3-byte UTF-8 characters plus the largest
// permitted challenge token plus JSON framing must fit (measured ~16.6 KB > the old
// 16 KiB cap). 24 KiB leaves headroom without materially changing abuse cost.
// API Gateway HTTP APIs have a fixed 10 MB payload ceiling that cannot be lowered, so this
// application cap is the effective limit (enforced before base64 decode and JSON parse).
export const INTAKE_LIMITS = Object.freeze({
  schemaVersion: "1.0",
  maxBodyBytes: 24576,
  minChallengeTokenChars: 12,
  maxChallengeTokenChars: 4096,
  idempotencyKey: "uuid-v4"
});
