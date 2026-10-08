// Pure reporting contract. No browser APIs, network effects or persisted drafts.
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

const text = value => String(value ?? "").trim();
const limit = (value, max, label) => {
  if (value.length > max) throw new Error(label + " must be " + max + " characters or less.");
  return value;
};
const required = (value, label) => {
  if (!value) throw new Error("Please enter " + label + ".");
  return value;
};

export function normalizeReport(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("A report is required.");
  const product = text(raw.product);
  const impact = text(raw.impact);
  if (!PRODUCTS.includes(product)) throw new Error("Please select the affected application.");
  if (!IMPACTS.includes(impact)) throw new Error("Please select how the defect affects you.");
  const title = required(limit(text(raw.title), 120, "The summary"), "a short summary");
  const actual = required(limit(text(raw.actual), 1200, "What happened"), "what happened");
  const expected = required(limit(text(raw.expected), 1200, "What you expected"), "what you expected");
  const steps = limit(text(raw.steps), 900, "Steps to reproduce");
  let pageUrl = text(raw.pageUrl);
  if (pageUrl) {
    if (pageUrl.length > 2000) throw new Error("The page URL is too long.");
    let parsed;
    try { parsed = new URL(pageUrl); }
    catch { throw new Error("Enter a valid page URL or leave it blank."); }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("The page URL must start with http or https.");
    }
    // Drop credentials, query parameters and fragments: they may contain secrets.
    pageUrl = parsed.origin + parsed.pathname;
  }
  if (raw.privacyAcknowledged !== true) {
    throw new Error("Please confirm you removed passwords and private information.");
  }
  return Object.freeze({ product, impact, title, actual, expected, steps, pageUrl });
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

export function buildIssueUrl(report) {
  const url = new URL("https://github.com/" + ISSUE_REPOSITORY + "/issues/new");
  url.searchParams.set("title", "[" + report.product + "] " + report.title);
  url.searchParams.set("body", formatIssueBody(report));
  if (url.toString().length > 7500) {
    throw new Error("This report is too long for GitHub's submission link. Shorten the description or steps to continue.");
  }
  return url.toString();
}
