import { createHash, randomUUID } from "node:crypto";

// Display names of the canonical registry schemas/products.v1.json (VIT-DOM-004).
// Constants because the Lambda candidate packages only service/; registry resolution
// (ids, aliases) lives in product-registry.mjs and tests/domain-registry.test.mjs
// fails if this list, site/submission.mjs and the registry diverge.
export const products = Object.freeze([
  "Arca", "Chrona", "Dokimos", "Fides", "Folio", "Forma",
  "Forma Studio", "HelixNote", "Ordo", "Praxis", "Signal", "Summa", "Other / not sure"
]);
export const impacts = Object.freeze([
  "Cannot use the feature", "Can use it with a workaround",
  "Minor inconvenience or display problem", "Not sure"
]);

export class IntakeError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "IntakeError";
    this.code = code;
    this.status = status;
  }
}
const refuse = (message) => { throw new IntakeError("invalid_input", 400, message); };

// ---------------------------------------------------------------------------------
// Text contract (VIT-API-002, VIT-DOM-003; DOM-001 "schema/runtime agreement").
// These pattern SOURCES are the single definition: normalizeReport compiles them, and
// schemas/intake-request.schema.json carries the identical literal strings
// (tests/domain-report-contract.test.mjs fails if they differ). The F# core mirrors the
// same rules and is checked against schemas/report-cases.v1.json.
//
// - Lengths are Unicode code points (JSON Schema semantics), measured on the raw value.
// - Refused anywhere: C0 controls except TAB/LF/CR, DEL, C1 controls, bidi marks,
//   embeddings, overrides and isolates (Trojan-source style spoofing), lone surrogates.
// - Required text must contain at least one visible character (not whitespace and not a
//   Unicode format character such as zero-width space/joiner or word joiner).
// - Accepted text is trimmed (ECMAScript whitespace) and NFC-normalised (VF-008).
// - Obvious credential disclosures are refused per field (case-insensitive by construction
//   because JSON Schema patterns carry no flags).
// ---------------------------------------------------------------------------------
// Explicit classes instead of \s, \S and \b: those differ between JS, ajv and .NET, while
// these literal classes mean the same thing in all three (ECMAScript WhiteSpace+LineTerminator).
export const WHITESPACE_CLASS = "\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
// Unsafe for display/storage: C0 except TAB/LF/CR, DEL, C1, ALM, LRM/RLM, bidi embeddings,
// overrides and isolates. Lone surrogates are refused separately (isWellFormed); the schema
// pattern adds \ud800-\udfff, which under the "u" flag matches lone surrogates only.
export const UNSAFE_CLASS = "\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069";
const SURROGATES = "\\ud800-\\udfff";
const WS = "[" + WHITESPACE_CLASS + "]";
const caseless = text => text.replace(/[a-z]/gi, c => "[" + c.toUpperCase() + c.toLowerCase() + "]");
export const CREDENTIAL_PATTERN = [
  caseless("-----BEGIN ") + "(?:" + ["RSA ", "EC ", "OPENSSH "].map(caseless).join("|") + ")?" + caseless("PRIVATE KEY-----"),
  caseless("gh") + "[pousrPOUSR]_[A-Za-z0-9_]{15,}",
  // Word boundary: "task-", "desk-", "disk-" in ordinary hyphenated words are not keys (D-06).
  "(?<![A-Za-z0-9_])" + caseless("sk") + "-[A-Za-z0-9_-]{18,}",
  "(?:" + caseless("password") + "|" + caseless("api") + "[_ -]?" + caseless("key") + ")" + WS + "*[:=]" + WS + "*[^" + WHITESPACE_CLASS + "]{4,}"
].join("|");
const NO_CREDENTIAL = "(?![\\s\\S]*(?:" + CREDENTIAL_PATTERN + "))";
const VISIBLE_CLASS = "[^" + WHITESPACE_CLASS + "\\p{Cf}]";
export const TEXT_PATTERNS = Object.freeze({
  required: "^" + NO_CREDENTIAL + "(?=[\\s\\S]*" + VISIBLE_CLASS + ")[^" + UNSAFE_CLASS + SURROGATES + "]*$",
  optional: "^" + NO_CREDENTIAL + "[^" + UNSAFE_CLASS + SURROGATES + "]*$",
  pageUrl: "^(?:|[Hh][Tt][Tt][Pp][Ss]?://[^" + WHITESPACE_CLASS + "/?#" + UNSAFE_CLASS + SURROGATES + "]+(?:[/?#][^" + WHITESPACE_CLASS + UNSAFE_CLASS + SURROGATES + "]*)?)$"
});
const compiled = Object.freeze({
  unsafe: new RegExp("[" + UNSAFE_CLASS + "]", "u"),
  edges: new RegExp("^" + WS + "+|" + WS + "+$", "gu"),
  visible: new RegExp(VISIBLE_CLASS, "u"),
  credential: new RegExp(CREDENTIAL_PATTERN, "u"),
  pageUrl: new RegExp(TEXT_PATTERNS.pageUrl, "u")
});
export const codePoints = text => [...text].length;

/** Reported-impact label -> impact code (defect schemas, products.v1.json impact ids). */
export const impactCodes = Object.freeze({
  "Cannot use the feature": "cannot-use",
  "Can use it with a workaround": "workaround",
  "Minor inconvenience or display problem": "minor",
  "Not sure": "unknown"
});

// kind: "required" | "optional". Optional fields: absent (undefined) or a string; null and
// other types are refused. A whitespace/format-only optional value means "not provided".
function field(value, name, max, kind) {
  if (value === undefined) {
    if (kind === "required") refuse("Please provide " + name + ".");
    return "";
  }
  if (typeof value !== "string") refuse(name + " must be text.");
  if (!value.isWellFormed() || compiled.unsafe.test(value)) refuse(name + " contains invalid characters.");
  if (codePoints(value) > max) refuse(name + " is too long.");
  if (compiled.credential.test(value)) refuse("This report appears to contain a credential. Remove it before sending.");
  const visible = compiled.visible.test(value);
  if (kind === "required" && !visible) refuse("Please provide " + name + ".");
  // NFC is the canonical form: canonically equivalent input yields identical output (VF-008).
  return visible ? value.replace(compiled.edges, "").normalize("NFC") : "";
}
function choice(value, name, allowed) {
  // Exact match only: padded or case-variant names are refused, never remapped (VIT-DOM-004).
  if (typeof value !== "string" || !allowed.includes(value)) refuse("Choose a supported " + name + ".");
  return value;
}
export function normalizeReport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse("Report must be an object.");
  const allowed = new Set(["schemaVersion","product","impact","title","actual","expected","steps","pageUrl","privacyAcknowledged","challengeToken"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) refuse("Unexpected report field.");
  }
  if (raw.schemaVersion !== "1.0") refuse("Unsupported report version.");
  if (raw.privacyAcknowledged !== true) refuse("Please confirm that sensitive details were removed.");
  const product = choice(raw.product, "application", products);
  const impact = choice(raw.impact, "impact", impacts);
  const title = field(raw.title, "summary", 120, "required");
  const actual = field(raw.actual, "what happened", 1200, "required");
  const expected = field(raw.expected, "what was expected", 1200, "required");
  const steps = field(raw.steps, "steps to reproduce", 900, "optional");
  let pageUrl = "";
  if (raw.pageUrl !== undefined) {
    if (typeof raw.pageUrl !== "string") refuse("page URL must be text.");
    if (!raw.pageUrl.isWellFormed() || codePoints(raw.pageUrl) > 2000) refuse("page URL is too long.");
    if (!compiled.pageUrl.test(raw.pageUrl)) refuse("Page URL must be HTTP or HTTPS.");
  }
  if (raw.pageUrl) {
    let url;
    try { url = new URL(raw.pageUrl); } catch { refuse("Enter a valid page URL."); }
    if (!["http:", "https:"].includes(url.protocol)) refuse("Page URL must be HTTP or HTTPS.");
    // Deliberately remove credentials, query and fragments from user-supplied URLs.
    pageUrl = url.origin + url.pathname;
  }
  return Object.freeze({schemaVersion:"1.0",product,impact,title,actual,expected,steps,pageUrl});
}
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const makeReference = () => "VIT-" + randomUUID().replaceAll("-", "").toUpperCase();
export function payloadHash(report) { return sha256(JSON.stringify(report)); }
export function assertIdempotencyKey(key) {
  if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    refuse("A valid request identifier is required.");
  }
  return sha256(key.toLowerCase());
}
