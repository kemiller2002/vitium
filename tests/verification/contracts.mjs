// Shared, side-effect-free helpers for adversarial contract tests.
// Effects (file reads) happen once at import; everything exported is pure/frozen.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");

export const repoPath = path => new URL("../../" + path, import.meta.url);
export const readRepo = path => readFileSync(repoPath(path), "utf8");
export const readJson = path => JSON.parse(readRepo(path));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

/** Compile a repository schema into a total validator returning {ok,value}|{ok:false,error}. */
export function schemaValidator(path) {
  const validate = ajv.compile(readJson(path));
  return value => validate(value)
    ? { ok: true, value }
    : { ok: false, error: validate.errors.map(e => (e.instancePath || "/") + " " + e.message) };
}

/** Wrap a throwing function as a total Result-returning one. */
export const attempt = fn => (...args) => {
  try { return { ok: true, value: fn(...args) }; }
  catch (error) { return { ok: false, error: { name: error?.name, code: error?.code, status: error?.status, message: error?.message } }; }
};

/** Pure: parse <option> values of a <select id=...> from static HTML. */
export function selectOptions(html, id) {
  const block = html.match(new RegExp('<select id="' + id + '"[\\s\\S]*?</select>'));
  if (!block) return [];
  return [...block[0].matchAll(/<option(?:\s+value="([^"]*)")?\s*>([^<]*)<\/option>/g)]
    .map(m => (m[1] ?? m[2]).trim())
    .filter(Boolean);
}

export const IDEMPOTENCY_KEY = "124e4567-e89b-42d3-a456-426614174000";
export const ORIGIN = "https://vitium.echelonfoundry.com";
export const CHALLENGE = "challenge-token-example-123";

export const validRequest = (patch = {}) => Object.freeze({
  schemaVersion: "1.0",
  product: "Forma",
  impact: "Cannot use the feature",
  title: "Cannot save a change",
  actual: "Save does nothing.",
  expected: "Changes should be saved.",
  steps: "Open form.\nTap save.",
  pageUrl: "https://example.com/path",
  privacyAcknowledged: true,
  ...patch
});

/** In-memory store honouring the putOnce contract; returns a fresh, closed-over Map. */
export function memoryStore() {
  const records = new Map();
  return {
    records,
    async putOnce(item) {
      if (records.has(item.pk)) return { created: false, existing: records.get(item.pk) };
      records.set(item.pk, item);
      return { created: true };
    },
    // Read-only replay port (fix round 1, service/adapters/dynamodb-store.mjs lookup):
    // projects receipt attributes only, never the report, as the real adapter does.
    async lookup(pk) {
      const hit = records.get(pk);
      return hit
        ? { ok: true, value: { found: true, existing: { reference: hit.reference, payloadHash: hit.payloadHash, receivedAt: hit.receivedAt } } }
        : { ok: true, value: { found: false } };
    }
  };
}

/** A verifier modelling a provider whose tokens are single-use (Turnstile siteverify semantics). */
export function singleUseVerifier() {
  const seen = new Set();
  return async token => {
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  };
}

export const httpEvent = (body, overrides = {}) => ({
  rawPath: "/api/v1/reports",
  requestContext: { http: { method: "POST" }, requestId: "req-adversarial" },
  headers: { origin: ORIGIN, "content-type": "application/json", "idempotency-key": IDEMPOTENCY_KEY },
  body: typeof body === "string" ? body : JSON.stringify({ challengeToken: CHALLENGE, ...body }),
  ...overrides
});
