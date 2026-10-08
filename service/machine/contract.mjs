// Machine-observation wire contract v1 (VIT-INT-013, VIT-INT-017, VIT-DOM-005).
// Single source of the patterns, enums and bounds that the JSON Schema
// (schemas/machine/observation-envelope.v1.schema.json) also declares; the test
// tests/machine-contract.test.mjs fails if the two copies diverge, and replays the shared
// cases (schemas/machine/cases/envelope-cases.v1.json) through both this runtime validator
// and ajv so their verdicts are proven identical.
//
// Pure: no clock, storage, randomness or network. Every function is total and returns
// {ok:true,value} | {ok:false,error:{code,message,path}}.
//
// This is a PROPOSED contract. No route serves it (see docs/machine/MACHINE-OBSERVATION-CONTRACT.md).

const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

export const SCHEMA_VERSION = "1.0";

// Forbidden in every free-text field: C0/C1 controls (so no newlines: multi-line log dumps
// cannot be sent), zero-width/format characters, line/paragraph separators, bidi
// embeddings/overrides/isolates, BOM. No leading/trailing space, so whitespace-only text
// is impossible. JSON-Schema-portable: no \s, \S, \b, no flags.
const FORBIDDEN_CLASS = "\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff";

export const PATTERNS = deepFreeze({
  eventId: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
  repository: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\\.{1,2}$)[A-Za-z0-9._-]{1,100}$",
  identifier: "^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$",
  commit: "^[0-9a-f]{40}$",
  sha256: "^[0-9a-f]{64}$",
  defectId: "^DEF-[0-9]{4,12}$",
  text: "^(?! )(?!.* $)[^" + FORBIDDEN_CLASS + "]+$",
  // https only; DNS host with an alphabetic TLD (so no IP literals, no "localhost", no
  // userinfo); optional port; path only: NO query string or fragment (tokens travel there).
  evidenceUri: "^https://(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}(?::[0-9]{1,5})?(?:/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)*$",
  instant: "^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d{1,9})?(?:Z|[+-](\\d{2}):(\\d{2}))$",
  originMarker: "^vitium/[A-Za-z0-9._:-]{1,128}$"
});

export const ENUMS = deepFreeze({
  // VIT-INT-017: distinct kinds for reports, failed/passed/inconclusive verification and
  // governance violations.
  eventType: ["observation.detected", "verification.failed", "verification.passed", "verification.inconclusive", "governance.violation"],
  // "vitium" is representable only so that self-originated echoes are recognised and
  // dropped (VIT-INT-015); it is never stored.
  system: ["praxis", "ordo", "conditor", "dokimos", "tutela", "aegis", "ci", "agent", "vitium"],
  environment: ["ci", "development", "staging", "production"],
  category: [
    "test-failure", "build-failure", "packaging-failure", "integration-failure",
    "deployment-verification-failure", "regression", "mutation-weakness", "quality-rule",
    "installation-failure", "compatibility-failure", "governance-violation", "security-rule",
    "runtime-fault", "agent-suspicion", "infrastructure-error", "flaky-test"
  ],
  // Producers may only submit untriaged findings; classification is a human/Ordo act.
  classification: ["untriaged"],
  confidence: ["observed", "suspected"],
  evidenceKind: ["test-result", "build-log-reference", "artifact", "attestation", "coverage-report", "mutation-report", "diagnostic-reference", "sbom"]
});

export const BOUNDS = deepFreeze({
  maxBodyBytes: 16384,
  identifierMax: 128,
  repositoryMax: 140,
  summaryMax: 200,
  detailMax: 1000,
  evidenceUriMax: 512,
  evidenceMin: 1,
  evidenceMax: 10,
  instantMax: 40,
  runAttemptMax: 1000
});

// Categories that are security-classified: private-security routing, never public (task 6).
export const SECURITY_CATEGORIES = deepFreeze(["security-rule"]);
export const SECURITY_SYSTEMS = deepFreeze(["tutela"]);
export const VERIFICATION_EVENT_TYPES = deepFreeze(["verification.failed", "verification.passed", "verification.inconclusive"]);

// Field names that would carry a credential. The envelope is closed, so these are already
// refused structurally; they are checked first anywhere in the body so the refusal is the
// explicit credential_in_body code (VIT-INT-016: never accept a credential in the body).
export const CREDENTIAL_FIELD_NAMES = deepFreeze(["credential", "credentials", "token", "accesstoken", "idtoken", "authorization", "apikey", "secret", "password", "principal", "bearer", "jwt", "oidctoken"]);

const ok = value => Object.freeze({ ok: true, value });
const err = (code, message, path) => Object.freeze({ ok: false, error: Object.freeze({ code, message, path }) });
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const compiled = Object.freeze(Object.fromEntries(Object.entries(PATTERNS).map(([k, p]) => [k, new RegExp(p, "u")])));
const codePoints = s => [...s].length; // JSON Schema maxLength counts code points

/** A real ISO-8601 instant: pattern plus calendar ranges (same rules as service/lifecycle.mjs isInstant). */
export function isInstant(text) {
  const m = typeof text === "string" && text.length <= BOUNDS.instantMax ? compiled.instant.exec(text) : null;
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const offH = m[7] === undefined ? 0 : Number(m[7]);
  const offM = m[8] === undefined ? 0 : Number(m[8]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return month >= 1 && month <= 12 && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59 && offH <= 23 && offM <= 59;
}

// --- tiny combinators: each checker is value -> path -> null | error ----------------
const str = (pattern, max, min = 1) => (v, path) =>
  typeof v !== "string" ? err("invalid_envelope", "Expected a string.", path)
    : codePoints(v) < min || codePoints(v) > max ? err("invalid_envelope", "Length out of bounds.", path)
    : !compiled[pattern].test(v) ? err("invalid_envelope", "Value has an invalid format.", path)
    : null;
const oneOf = list => (v, path) => list.includes(v) ? null : err("invalid_envelope", "Value is not an allowed option.", path);
const nullable = check => (v, path) => v === null ? null : check(v, path);
const instant = (v, path) => typeof v === "string" && isInstant(v) ? null : err("invalid_envelope", "Expected an ISO-8601 instant with offset.", path);
const integer = (min, max) => (v, path) => Number.isSafeInteger(v) && v >= min && v <= max ? null : err("invalid_envelope", "Integer out of bounds.", path);

// Shapes are Maps and every membership test is an OWN-property test (VF-029): `key in obj`
// is true for inherited names such as constructor, toString or __proto__, which would let
// them pass the closed-envelope check while the JSON Schema refuses them.
function obj(shapeLiteral, required) {
  const shape = new Map(Object.entries(shapeLiteral));
  return (v, path) => {
    if (!isObject(v)) return err("invalid_envelope", "Expected an object.", path);
    // Reflect.ownKeys also sees an own "__proto__" key created by JSON.parse, and symbols.
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key !== "string" || !shape.has(key)) return err("invalid_envelope", "Unexpected field.", path + "." + String(key));
    }
    for (const key of required) if (!Object.hasOwn(v, key)) return err("invalid_envelope", "Missing required field.", path + "." + key);
    for (const [key, check] of shape) {
      if (!Object.hasOwn(v, key)) continue;
      const e = check(v[key], path + "." + key);
      if (e) return e;
    }
    return null;
  };
}
const arr = (item, min, max) => (v, path) => {
  if (!Array.isArray(v)) return err("invalid_envelope", "Expected a list.", path);
  if (v.length < min || v.length > max) return err("invalid_envelope", "List length out of bounds.", path);
  for (let i = 0; i < v.length; i++) { const e = item(v[i], path + "[" + i + "]"); if (e) return e; }
  return null;
};

const ident = str("identifier", BOUNDS.identifierMax);
const envelopeShape = obj({
  schemaVersion: (v, p) => v === SCHEMA_VERSION ? null : err("unsupported_version", "Unsupported schemaVersion.", p),
  eventId: str("eventId", 36, 36),
  eventType: oneOf(ENUMS.eventType),
  source: obj({
    system: oneOf(ENUMS.system),
    repository: str("repository", BOUNDS.repositoryMax, 3),
    installationId: ident,
    version: ident
  }, ["system", "repository", "installationId", "version"]),
  subject: obj({
    workItemId: nullable(ident),
    commit: str("commit", 40, 40),
    runId: ident,
    runAttempt: integer(1, BOUNDS.runAttemptMax),
    checkId: ident,
    environment: oneOf(ENUMS.environment)
  }, ["workItemId", "commit", "runId", "checkId", "environment"]),
  finding: obj({
    category: oneOf(ENUMS.category),
    summary: str("text", BOUNDS.summaryMax),
    expected: str("text", BOUNDS.detailMax),
    observed: str("text", BOUNDS.detailMax),
    classification: oneOf(ENUMS.classification),
    confidence: oneOf(ENUMS.confidence)
  }, ["category", "summary", "expected", "observed", "classification", "confidence"]),
  evidence: arr(obj({
    kind: oneOf(ENUMS.evidenceKind),
    uri: str("evidenceUri", BOUNDS.evidenceUriMax, 9),
    sha256: str("sha256", 64, 64)
  }, ["kind", "uri", "sha256"]), BOUNDS.evidenceMin, BOUNDS.evidenceMax),
  correlation: obj({
    defectId: nullable(str("defectId", 16, 8)),
    verificationAttemptId: nullable(ident),
    causationEventId: nullable(str("eventId", 36, 36)),
    originMarker: nullable(str("originMarker", 135, 8))
  }, ["defectId", "verificationAttemptId", "causationEventId"]),
  observedAt: instant
}, ["schemaVersion", "eventId", "eventType", "source", "subject", "finding", "evidence", "correlation", "observedAt"]);

// Cross-field rules (mirrored by allOf/if/then in the schema).
function crossField(e) {
  if (VERIFICATION_EVENT_TYPES.includes(e.eventType) && e.correlation.verificationAttemptId === null) {
    return err("invalid_envelope", "Verification events need a verificationAttemptId.", "$.correlation.verificationAttemptId");
  }
  if (VERIFICATION_EVENT_TYPES.includes(e.eventType) && e.correlation.defectId === null) {
    return err("invalid_envelope", "Verification events need a defectId.", "$.correlation.defectId");
  }
  if ((e.eventType === "governance.violation") !== (e.finding.category === "governance-violation")) {
    return err("invalid_envelope", "governance.violation events and the governance-violation category go together.", "$.finding.category");
  }
  // uniqueItems (whole evidence item, key order irrelevant, as JSON Schema deep equality).
  const keys = e.evidence.map(x => x.kind + "\u0000" + x.uri + "\u0000" + x.sha256);
  if (new Set(keys).size !== keys.length) return err("invalid_envelope", "Evidence items must be unique.", "$.evidence");
  return null;
}

/**
 * Structural validation exactly equivalent to the JSON Schema. Does NOT redact or apply
 * safety heuristics (that is observation-core's `screenEnvelope`). Returns a frozen deep copy.
 */
export function validateEnvelope(raw) {
  const shapeError = envelopeShape(raw, "$");
  if (shapeError) return shapeError;
  const crossError = crossField(raw);
  if (crossError) return crossError;
  return ok(deepFreeze(structuredClone(raw)));
}

/** Walk any JSON value for keys that name a credential (case/punctuation-insensitive). */
export function findCredentialField(value, path = "$", depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  for (const key of Object.keys(value)) {
    const child = value[key];
    const norm = key.toLowerCase().replace(/[^a-z]/g, "");
    if (CREDENTIAL_FIELD_NAMES.includes(norm)) return path + "." + key;
    const found = findCredentialField(child, path + (Array.isArray(value) ? "[" + key + "]" : "." + key), depth + 1);
    if (found) return found;
  }
  return null;
}
