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
function field(value, name, max, mandatory = false) {
  if (typeof value !== "string") {
    if (mandatory || value != null) refuse(name + " must be text.");
    return "";
  }
  const clean = value.trim();
  if (mandatory && !clean) refuse("Please provide " + name + ".");
  if (clean.length > max) refuse(name + " is too long.");
  // Block binary/control characters; line breaks are allowed in descriptions.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean)) refuse(name + " contains invalid characters.");
  return clean;
}
export function normalizeReport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse("Report must be an object.");
  const allowed = new Set(["schemaVersion","product","impact","title","actual","expected","steps","pageUrl","privacyAcknowledged","challengeToken"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) refuse("Unexpected report field.");
  }
  if (raw.schemaVersion !== "1.0") refuse("Unsupported report version.");
  if (raw.privacyAcknowledged !== true) refuse("Please confirm that sensitive details were removed.");
  const product = field(raw.product,"application",100,true);
  const impact = field(raw.impact,"impact",100,true);
  if (!products.includes(product)) refuse("Choose a supported application.");
  if (!impacts.includes(impact)) refuse("Choose a supported impact.");
  const title = field(raw.title, "summary", 120, true);
  const actual = field(raw.actual, "what happened", 1200, true);
  const expected = field(raw.expected, "what was expected", 1200, true);
  const steps = field(raw.steps, "steps to reproduce", 900);
  let pageUrl = field(raw.pageUrl, "page URL", 2000);
  if (pageUrl) {
    let url;
    try { url = new URL(pageUrl); } catch { refuse("Enter a valid page URL."); }
    if (!["http:", "https:"].includes(url.protocol)) refuse("Page URL must be HTTP or HTTPS.");
    // Deliberately remove credentials, query and fragments from user-supplied URLs.
    pageUrl = url.origin + url.pathname;
  }
  const text = [title, actual, expected, steps].join("\n");
  // A guardrail for obvious credential disclosures, not a claim of comprehensive DLP.
  if (/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{15,}|sk-[A-Za-z0-9_-]{18,}|(?:password|api[_ -]?key)\s*[:=]\s*\S{4,})/i.test(text)) {
    refuse("This report appears to contain a credential. Remove it before sending.");
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
