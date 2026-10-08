// Pure reporting contract. No browser APIs, network effects or persisted drafts.
export const ISSUE_REPOSITORY = "kemiller2002/vitium";
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
export const LEGACY_LIMITS = Object.freeze({ title: 120, actual: 1200, expected: 1200, steps: 900, pageUrl: 2000 });

const text = value => String(value ?? "").trim();
const fieldError = (field, code, message) => Object.freeze({ field, code, message });

const textRule = (field, max, label, requiredLabel) => value => {
  if (value.length > max) return fieldError(field, "too_long", label + " must be " + max + " characters or less.");
  if (requiredLabel && !value) return fieldError(field, "required", "Please enter " + requiredLabel + ".");
  return null;
};

function checkUrl(value) {
  if (!value) return { ok: true, value: "" };
  if (value.length > LEGACY_LIMITS.pageUrl) return { ok: false, error: fieldError("pageUrl", "too_long", "The page URL is too long.") };
  let parsed;
  try { parsed = new URL(value); }
  catch { return { ok: false, error: fieldError("pageUrl", "invalid_url", "Enter a valid page URL or leave it blank.") }; }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: fieldError("pageUrl", "url_scheme", "The page URL must start with http or https.") };
  }
  // Drop credentials, query parameters and fragments: they may contain secrets.
  return { ok: true, value: parsed.origin + parsed.pathname };
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
    textRule("title", LEGACY_LIMITS.title, "The summary", "a short summary")(values.title),
    textRule("actual", LEGACY_LIMITS.actual, "What happened", "what happened")(values.actual),
    textRule("expected", LEGACY_LIMITS.expected, "What you expected", "what you expected")(values.expected),
    textRule("steps", LEGACY_LIMITS.steps, "Steps to reproduce", null)(values.steps),
    url.ok ? null : url.error,
    raw.privacyAcknowledged === true ? null
      : fieldError("privacyAcknowledged", "unacknowledged", "Please confirm you removed passwords and private information.")
  ].filter(Boolean);
  if (errors.length) return { ok: false, errors: Object.freeze(errors) };
  return { ok: true, value: Object.freeze({ ...values, pageUrl: url.value }) };
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

