import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTS, IMPACTS, normalizeReport, formatIssueBody, buildIssueUrl } from "../site/submission.mjs";

const valid = (changes = {}) => ({
  product: "Forma",
  impact: IMPACTS[0],
  title: "Dialog buttons stop working on a phone",
  actual: "The dialog button does nothing.",
  expected: "The dialog should close.",
  steps: "Open the dialog.\nTap Close.",
  pageUrl: "https://example.com/path?access_token=secret#private",
  privacyAcknowledged: true,
  ...changes
});

test("normalization trims values, accepts known products and strips URL secrets", () => {
  const r = normalizeReport(valid({ title: "  broken dialog  " }));
  assert.equal(r.title, "broken dialog");
  assert.equal(r.pageUrl, "https://example.com/path");
  assert.ok(Object.isFrozen(r));
  assert.ok(PRODUCTS.includes(r.product));
});

test("all required user statements and impact are validated", () => {
  for (const field of ["product", "title", "actual", "expected", "impact"]) {
    assert.throws(() => normalizeReport(valid({ [field]: "" })));
  }
  assert.throws(() => normalizeReport(valid({ privacyAcknowledged: false })), /confirm/);
  assert.throws(() => normalizeReport(valid({ product: "made-up-app" })), /select/);
  assert.throws(() => normalizeReport(valid({ impact: "Critical P0" })), /select/);
});

test("invalid URL schemes and invalid URLs are rejected", () => {
  for (const pageUrl of ["javascript:alert(1)", "file:///etc/passwd", "not-a-url", "data:text/html,<p>oops</p>"]) {
    assert.throws(() => normalizeReport(valid({ pageUrl })), /URL/);
  }
});

test("input size limits are enforced without silent truncation", () => {
  for (const [field, max] of [["title",120],["actual",1200],["expected",1200],["steps",900]]) {
    assert.throws(() => normalizeReport(valid({ [field]: "a".repeat(max + 1) })), /characters/);
  }
});

test("report body preserves evidence, including multiline input, but not URL tokens", () => {
  const r = normalizeReport(valid());
  const body = formatIssueBody(r);
  assert.match(body, /vitium-report:v1/);
  assert.match(body, /> Open the dialog\.\n> Tap Close\./);
  assert.match(body, /The dialog should close/);
  assert.doesNotMatch(body, /access_token|private/);
});

test("issue link points to the public intake repo with populated content", () => {
  const r = normalizeReport(valid());
  const url = new URL(buildIssueUrl(r));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/kemiller2002/vitium/issues/new");
  assert.equal(url.searchParams.get("title"), "[Forma] " + r.title);
  assert.match(url.searchParams.get("body"), /The dialog button does nothing/);
});

test("too-large encoded links are rejected, not silently shortened", () => {
  const r = normalizeReport(valid({
    actual: "🪲".repeat(550),
    expected: "✔".repeat(1000),
    steps: "🐛".repeat(430)
  }));
  assert.throws(() => buildIssueUrl(r), /too long/);
});

test("empty optional steps and URL are allowed", () => {
  const r = normalizeReport(valid({ steps: "", pageUrl: "" }));
  assert.match(formatIssueBody(r), /_Not provided_/);
});
