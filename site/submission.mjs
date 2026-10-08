// Pure reporting contract. No browser APIs, network effects or persisted drafts.
import { credentialKinds, CREDENTIAL_MESSAGE, CREDENTIAL_URL_MESSAGE } from "./credential-guard.mjs";
export const ISSUE_REPOSITORY = "kemiller2002/vitium";
// PRODUCTS and IMPACTS are the display names of schemas/products.v1.json (canonical
// registry, VIT-DOM-004). Pages serves only site/, so they are constants here;
// tests/domain-registry.test.mjs fails if they diverge from the registry or service list.
export const PRODUCTS = Object.freeze([
  "Arca", "Chrona", "Dokimos", "Fides", "Folio", "Forma",
  "Forma Studio", "HelixNote", "Ordo", "Praxis", "Signal", "Summa",
  "Other / not sure"
]);
export const IMPACTS = Object.freeze([
  "Cannot use the feature",
  "Can use it with a workaround",
  "Minor inconvenience or display problem",
  "Not sure"
]);

// Field order is the order the form presents them; the first error matches the
// historical single-message behaviour of normalizeReport (baseline 2026-10-08).
export const FIELD_ORDER = Object.freeze([
  "product", "impact", "title", "actual", "expected", "steps", "pageUrl", "privacyAcknowledged"
]);
export const SCHEMA_VERSION = "1.0";
export const LEGACY_LIMITS = Object.freeze({ title: 120, actual: 1200, expected: 1200, steps: 900, pageUrl: 2000 });

const text = value => String(value ?? "").trim();
// Lengths are Unicode code points, matching the service and JSON Schema semantics.
export const lengthOf = value => [...value].length;
const fieldError = (field, code, message) => Object.freeze({ field, code, message });

/** Over-limit message for one field, or null. Used live while typing (VF-003). */
export function lengthError(field, value) {
  const max = LEGACY_LIMITS[field];
  if (!max || typeof value !== "string") return null;
  const length = lengthOf(value.trim());
  if (length <= max) return null;
  const labels = { title: "The summary", actual: "What happened", expected: "What you expected", steps: "Steps to reproduce", pageUrl: "The page URL" };
  return fieldError(field, "too_long", labels[field] + " must be " + max.toLocaleString("en-US") + " characters or less. It is " +
    length.toLocaleString("en-US") + " characters now; shorten it by " + (length - max).toLocaleString("en-US") + ". Nothing has been cut.");
}

const textRule = (field, requiredLabel) => value => {
  const tooLong = lengthError(field, value);
  if (tooLong) return tooLong;
  if (requiredLabel && !value) return fieldError(field, "required", "Please enter " + requiredLabel + ".");
  if (credentialKinds(value).length) return fieldError(field, "credential", CREDENTIAL_MESSAGE);
  return null;
};

/** Sanitise first, then check the length of what will actually be sent (VF-011). */
export function checkUrl(value) {
  if (!value) return { ok: true, value: "" };
  let parsed;
  try { parsed = new URL(value); }
  catch { return { ok: false, error: fieldError("pageUrl", "invalid_url", "Enter a valid page URL or leave it blank.") }; }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: fieldError("pageUrl", "url_scheme", "The page URL must start with http or https.") };
  }
  // Drop credentials, query parameters and fragments: they may contain secrets.
  const sanitized = parsed.origin + parsed.pathname;
  if (lengthOf(sanitized) > LEGACY_LIMITS.pageUrl) {
    return { ok: false, error: fieldError("pageUrl", "too_long",
      "The page URL is too long (" + lengthOf(sanitized).toLocaleString("en-US") + " characters after removing the query and fragment; the limit is 2,000). Shorten it or leave it blank.") };
  }
  if (credentialKinds(sanitized).length) {
    return { ok: false, error: fieldError("pageUrl", "credential", CREDENTIAL_URL_MESSAGE) };
  }
  return { ok: true, value: sanitized };
}

/**
 * Total validation: never throws. Returns every field error in form order so the
 * UI can render an error summary, or the frozen normalized report.
 * @returns {{ok:true,value:object}|{ok:false,errors:ReadonlyArray<{field:string,code:string,message:string}>}}
 */
export function validateReport(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: Object.freeze([fieldError(null, "invalid_report", "A report is required.")]) };
  }
  const values = {
    product: text(raw.product), impact: text(raw.impact), title: text(raw.title),
    actual: text(raw.actual), expected: text(raw.expected), steps: text(raw.steps)
  };
  const url = checkUrl(text(raw.pageUrl));
  const errors = [
    PRODUCTS.includes(values.product) ? null : fieldError("product", "required", "Please select the affected application."),
    IMPACTS.includes(values.impact) ? null : fieldError("impact", "required", "Please select how the defect affects you."),
    textRule("title", "a short summary")(values.title),
    textRule("actual", "what happened")(values.actual),
    textRule("expected", "what you expected")(values.expected),
    textRule("steps", null)(values.steps),
    url.ok ? null : url.error,
    raw.privacyAcknowledged === true ? null
      : fieldError("privacyAcknowledged", "unacknowledged", "Please confirm you removed passwords and private information.")
  ].filter(Boolean);
  if (errors.length) return { ok: false, errors: Object.freeze(errors) };
  // The normalized report is the v1.0 intake payload shape (minus the challenge
  // token): schemaVersion included, blank optional fields OMITTED (VF-005).
  const { steps, ...required } = values;
  return { ok: true, value: Object.freeze({
    schemaVersion: SCHEMA_VERSION, ...required,
    ...(steps ? { steps } : {}),
    ...(url.value ? { pageUrl: url.value } : {})
  }) };
}

/** Compatibility wrapper: throws the first validation message (legacy contract). */
export function normalizeReport(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("A report is required.");
  const result = validateReport(raw);
  if (!result.ok) throw new Error(result.errors[0].message);
  return result.value;
}

function quote(value) {
  return value.split(/\r?\n/).map(line => "> " + line).join("\n");
}

export function formatIssueBody(report) {
  // Structural metadata is derived from allowlisted product/impact values only.
  return [
    "<!-- vitium-report:v1; product=" + report.product + "; impact=" + report.impact + " -->",
    "## Affected application", report.product,
    "## What happened", quote(report.actual),
    "## What I expected", quote(report.expected),
    "## How it affects me", report.impact,
    "## How to reproduce", report.steps ? quote(report.steps) : "_Not provided_",
    "## Page or screen", report.pageUrl || "_Not provided_",
    "",
    "_Submitted through the Vitium public reporting form. The reporter should review this issue before publishing._"
  ].join("\n\n");
}

export const MAX_ISSUE_URL_LENGTH = 7500;

/** Total variant of buildIssueUrl for the UI reducer. */
export function tryBuildIssueUrl(report) {
  // Defence in depth (VF-004): never place credential-looking text in a public URL,
  // even if a caller skipped validateReport.
  const unsafe = ["title", "actual", "expected", "steps", "pageUrl"].find(f => credentialKinds(report[f]).length);
  if (unsafe) return { ok: false, error: fieldError(unsafe, "credential", unsafe === "pageUrl" ? CREDENTIAL_URL_MESSAGE : CREDENTIAL_MESSAGE) };
  const url = new URL("https://github.com/" + ISSUE_REPOSITORY + "/issues/new");
  url.searchParams.set("title", "[" + report.product + "] " + report.title);
  url.searchParams.set("body", formatIssueBody(report));
  const href = url.toString();
  if (href.length > MAX_ISSUE_URL_LENGTH) {
    return { ok: false, error: fieldError(null, "handoff_too_long",
      "This report is too long for GitHub's submission link. Shorten the description or steps to continue.") };
  }
  return { ok: true, value: href };
}

export function buildIssueUrl(report) {
  const result = tryBuildIssueUrl(report);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

