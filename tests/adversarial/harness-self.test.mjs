// Self-checks for the verification harness itself, so a broken harness cannot
// silently produce green browser evidence (VIT-VER-003).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveSitePath, startStaticServer } from "../verification/static-server.mjs";
import { safeLaunchArgs, chooseChromium } from "../verification/chromium-launch.mjs";
import { classifyRequest, formaModeFrom, FORMA_CSS_URL } from "../browser/support.mjs";
import { applyMutation } from "../verification/mutation-appraisal.mjs";
import { selectOptions } from "../verification/contracts.mjs";

const root = new URL("../../site/", import.meta.url).pathname;

test("VIT-AC-001 harness: static server refuses traversal and unknown types", () => {
  for (const path of ["/..%2fservice/intake.mjs", "/..%2f..%2fpackage.json", "/%00index.html", "/%E0%A4%A"]) {
    assert.equal(resolveSitePath(root, path).ok, false, path);
  }
  // Dot segments are clamped by URL parsing: they may only ever resolve inside root.
  for (const path of ["/../package.json", "/%2e%2e/package.json", "/a/../../../etc/passwd.txt"]) {
    const r = resolveSitePath(root, path);
    assert.ok(!r.ok || r.value.file.startsWith(root), path + " escaped root: " + r.value?.file);
  }
  assert.equal(resolveSitePath(root, "/").value.file.endsWith("site/index.html"), true);
  assert.equal(resolveSitePath(root, "/app.mjs").value.type, "text/javascript; charset=utf-8");
  assert.equal(resolveSitePath(root, "/secret.env").ok, false);
});

test("VIT-AC-001 harness: static server serves the site and 404s outside it", async () => {
  const server = await startStaticServer({ root });
  assert.ok(server.ok);
  try {
    const page = await fetch(server.value.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="defect-form"/);
    assert.equal((await fetch(server.value.url + "nope.html")).status, 404);
    assert.equal((await fetch(server.value.url, { method: "POST" })).status, 405);
  } finally { await server.value.close(); }
});

test("VIT-AC-015 harness: vendor Chromium flags that disable web security are never forwarded", () => {
  const vendor = ["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials",
    "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process", "--headless='shell'", "--single-process",
    "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"];
  assert.deepEqual([...safeLaunchArgs(vendor)], ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"]);
  assert.equal(chooseChromium({}).value.kind, "playwright-managed");
  assert.equal(chooseChromium({ VITIUM_LOCAL_CHROMIUM: "sparticuz" }).value.kind, "sparticuz");
  assert.equal(chooseChromium({ VITIUM_LOCAL_CHROMIUM: "other" }).ok, false);
});

test("VIT-AC-002 harness: network guard only lets the local site (and optionally the exact Forma URL) through", () => {
  const site = "http://127.0.0.1:4173/";
  assert.equal(classifyRequest(site + "app.mjs", { siteOrigin: site, formaMode: "block" }), "site");
  for (const url of ["https://github.com/kemiller2002/vitium/issues/new?title=x", "https://intake.vitium.echelonfoundry.com/api/v1/reports",
    "https://challenges.cloudflare.com/turnstile/v0/api.js", "http://127.0.0.1:4174/", "http://127.0.0.1:4173.evil.example/"]) {
    assert.equal(classifyRequest(url, { siteOrigin: site, formaMode: "cdn" }), "abort", url);
  }
  assert.equal(classifyRequest(FORMA_CSS_URL, { siteOrigin: site, formaMode: "block" }), "abort");
  assert.equal(classifyRequest(FORMA_CSS_URL, { siteOrigin: site, formaMode: "cdn" }), "forma-cdn");
  assert.equal(classifyRequest(FORMA_CSS_URL.replace("0.3.0", "0.4.1"), { siteOrigin: site, formaMode: "cdn" }), "abort");
  assert.equal(formaModeFrom({}), "block");
  assert.equal(formaModeFrom({ VITIUM_ALLOW_FORMA_CDN: "1" }), "cdn");
});

test("VIT-VER-003 harness: mutation application refuses missing or ambiguous anchors", () => {
  assert.equal(applyMutation("a b a", { from: "a", to: "x" }).ok, false);
  assert.equal(applyMutation("a b", { from: "z", to: "x" }).ok, false);
  assert.equal(applyMutation("a b", { from: "b", to: "x" }).value, "a x");
});

test("VIT-DOM-004 harness: option parser handles value attributes and placeholders", () => {
  const html = '<select id="p" required><option value="">Pick</option><option>A</option><option value="b">B label</option></select>';
  assert.deepEqual(selectOptions(html, "p"), ["A", "b"]);
});
