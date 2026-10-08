import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTS, IMPACTS, FIELD_ORDER, normalizeReport, validateReport, formatIssueBody, buildIssueUrl, tryBuildIssueUrl
} from "../site/submission.mjs";

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

test("validateReport is total and reports every invalid field in form order", () => {
  for (const raw of [null, undefined, 3, "x"]) assert.equal(validateReport(raw).ok, false);
  const result = validateReport({ steps: "s".repeat(901), pageUrl: "ftp://x" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(e => e.field),
    ["product", "impact", "title", "actual", "expected", "steps", "pageUrl", "privacyAcknowledged"]);
  assert.deepEqual(FIELD_ORDER, result.errors.map(e => e.field));
  for (const e of result.errors) assert.ok(typeof e.code === "string" && typeof e.message === "string");
  const ok = validateReport(valid());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, normalizeReport(valid()));
});

test("URL sanitisation removes credentials, query and fragment for every accepted URL shape", () => {
  const cases = [
    ["https://user:pa55@example.com/a/b?token=t#frag", "https://example.com/a/b"],
    ["http://example.com:8080/x;jsessionid=abc?x=1", "http://example.com:8080/x;jsessionid=abc"],
    ["HTTPS://EXAMPLE.com/Path#access_token=zzz", "https://example.com/Path"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com/?", "https://example.com/"]
  ];
  for (const [input, expected] of cases) {
    const r = validateReport(valid({ pageUrl: input }));
    assert.equal(r.ok, true, input);
    assert.equal(r.value.pageUrl, expected, input);
    assert.doesNotMatch(buildIssueUrl(r.value), /pa55|token=t|frag|access_token|x%3D1/);
  }
});

test("tryBuildIssueUrl is total and agrees with buildIssueUrl", () => {
  const r = normalizeReport(valid());
  assert.deepEqual(tryBuildIssueUrl(r), { ok: true, value: buildIssueUrl(r) });
  const big = normalizeReport(valid({ actual: "🪲".repeat(550), expected: "✔".repeat(1000), steps: "🐛".repeat(430) }));
  const failed = tryBuildIssueUrl(big);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "handoff_too_long");
});
