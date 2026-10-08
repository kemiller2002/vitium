// VIT-NFR-003 / VIT-AC-014 / VIT-AC-015: pure parts of scripts/verify-public-site.mjs.
// No network: every effect is injected with fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateCname, classifyNetworkError, evaluateDocumentResponse, evaluateCanonical,
  evaluateNoGithubIo, extractSameOriginAssets, extractModuleImports, evaluateAssets,
  evaluateSecrets, summarize, CANONICAL_URL, Reason
} from "../scripts/lib/public-site-checks.mjs";
import { verifyPublicSite } from "../scripts/verify-public-site.mjs";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const siteHtml = read("site/index.html");
const reasonOf = r => r.ok ? "OK" : r.error.reason;

test("DNS: exact CNAME passes; NXDOMAIN, wrong target, multiple targets and resolver errors fail with distinct reasons", () => {
  assert.equal(reasonOf(evaluateCname({ ok: true, value: ["kemiller2002.github.io."] })), "OK");
  assert.equal(reasonOf(evaluateCname({ ok: true, value: ["KEMILLER2002.GITHUB.IO"] })), "OK");
  assert.equal(reasonOf(evaluateCname({ ok: false, error: { code: "ENOTFOUND" } })), "DNS_NXDOMAIN");
  assert.equal(reasonOf(evaluateCname({ ok: false, error: { code: "ECONNREFUSED" } })), "DNS_LOOKUP_FAILED");
  assert.equal(reasonOf(evaluateCname({ ok: true, value: ["kemiller2002.github.io/vitium"] })), "DNS_WRONG_TARGET");
  assert.equal(reasonOf(evaluateCname({ ok: true, value: ["evil.github.io"] })), "DNS_WRONG_TARGET");
  assert.equal(reasonOf(evaluateCname({ ok: true, value: ["kemiller2002.github.io", "x.example"] })), "DNS_WRONG_TARGET");
  assert.equal(reasonOf(evaluateCname({ ok: true, value: [] })), "DNS_WRONG_TARGET");
});

test("network errors are classified so proxy denial is never mistaken for site state", () => {
  assert.equal(reasonOf(classifyNetworkError({ code: "CERT_HAS_EXPIRED" })), "TLS_INVALID");
  assert.equal(reasonOf(classifyNetworkError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })), "TLS_INVALID");
  assert.equal(reasonOf(classifyNetworkError({ code: "ENOTFOUND" })), "DNS_NXDOMAIN");
  assert.equal(reasonOf(classifyNetworkError({ code: "PROXY_DENIED" })), "NETWORK_BLOCKED");
  assert.equal(reasonOf(classifyNetworkError({ code: "ECONNRESET" })), "HTTPS_UNREACHABLE");
  const exits = Object.values(Reason).map(r => r.exit);
  assert.equal(new Set(exits).size, exits.length, "exit codes must be unique per reason");
  assert.ok(exits.every(e => e > 0));
});

test("document response: 200 passes; github.io or offsite redirects and non-200 fail", () => {
  assert.equal(reasonOf(evaluateDocumentResponse({ status: 200 })), "OK");
  assert.equal(reasonOf(evaluateDocumentResponse({ status: 301, headers: { location: "https://kemiller2002.github.io/vitium/" } })), "REDIRECT_OFFSITE");
  assert.equal(reasonOf(evaluateDocumentResponse({ status: 302, headers: { location: "https://example.com/" } })), "REDIRECT_OFFSITE");
  assert.equal(reasonOf(evaluateDocumentResponse({ status: 302, headers: {} })), "REDIRECT_OFFSITE");
  assert.equal(reasonOf(evaluateDocumentResponse({ status: 301, headers: { location: "/index.html" } })), "HTTP_STATUS");
  assert.equal(reasonOf(evaluateDocumentResponse({ status: 404 })), "HTTP_STATUS");
});

test("canonical: the committed site passes; missing, wrong, github.io and duplicate canonicals fail", () => {
  assert.equal(reasonOf(evaluateCanonical(siteHtml)), "OK");
  assert.equal(reasonOf(evaluateCanonical("<html></html>")), "CANONICAL_MISSING");
  assert.equal(reasonOf(evaluateCanonical('<link rel="canonical" href="https://kemiller2002.github.io/vitium/">')), "CANONICAL_MISMATCH");
  assert.equal(reasonOf(evaluateCanonical('<link rel="canonical" href="http://vitium.echelonfoundry.com/">')), "CANONICAL_MISMATCH");
  assert.equal(reasonOf(evaluateCanonical(`<link rel="canonical" href="${CANONICAL_URL}"><link rel="canonical" href="${CANONICAL_URL}x">`)), "CANONICAL_MISMATCH");
  assert.equal(reasonOf(evaluateCanonical(`<link href='${CANONICAL_URL}' rel='canonical'>`)), "OK");
});

test("github.io references anywhere in served text fail; committed site has none", () => {
  assert.equal(reasonOf(evaluateNoGithubIo(siteHtml)), "OK");
  assert.equal(reasonOf(evaluateNoGithubIo('<meta http-equiv="refresh" content="0;url=https://kemiller2002.github.io/vitium/">')), "GITHUB_IO_REFERENCE");
  assert.equal(reasonOf(evaluateNoGithubIo('<meta property="og:url" content="http://x.github.io">')), "GITHUB_IO_REFERENCE");
});

test("asset extraction finds exactly the committed same-origin assets and ignores the CDN", () => {
  const assets = extractSameOriginAssets(siteHtml, CANONICAL_URL);
  assert.deepEqual([...assets].sort(), [`${CANONICAL_URL}app.mjs`, `${CANONICAL_URL}styles.css`].sort());
  assert.ok(assets.every(a => !a.includes("cdn.jsdelivr.net")));
  const imports = extractModuleImports(read("site/app.mjs"), `${CANONICAL_URL}app.mjs`);
  assert.deepEqual([...imports].sort(), [`${CANONICAL_URL}public-config.mjs`, `${CANONICAL_URL}submission.mjs`].sort());
  assert.deepEqual(extractModuleImports('import x from "https://cdn.example/x.js"; import "./y.mjs";', `${CANONICAL_URL}a.mjs`), [`${CANONICAL_URL}y.mjs`]);
});

test("assets: any non-200 or transport error fails", () => {
  assert.equal(reasonOf(evaluateAssets([{ url: "a", status: 200 }])), "OK");
  assert.equal(reasonOf(evaluateAssets([{ url: "a", status: 200 }, { url: "b", status: 404 }])), "ASSET_FAILED");
  assert.equal(reasonOf(evaluateAssets([{ url: "a", status: null, error: "ECONNRESET" }])), "ASSET_FAILED");
});

test("secret canary in served JS fails; finding detail is masked", () => {
  const canary = ["gh", "p_", "C".repeat(36)].join("");
  const r = evaluateSecrets([{ url: `${CANONICAL_URL}app.mjs`, body: `const t="${canary}"` }]);
  assert.equal(reasonOf(r), "SECRET_FOUND");
  assert.ok(!r.error.detail.includes(canary));
  assert.equal(reasonOf(evaluateSecrets([{ url: "x", body: siteHtml }])), "OK");
});

test("summarize returns the first failing exit code and ok only when every check passes", () => {
  const pass = { ok: true, value: 1 };
  const failDns = { ok: false, error: { reason: "DNS_NXDOMAIN", exit: 10 } };
  const failTls = { ok: false, error: { reason: "TLS_INVALID", exit: 21 } };
  assert.equal(summarize([{ name: "a", result: pass }]).exit, 0);
  const s = summarize([{ name: "a", result: pass }, { name: "b", result: failDns }, { name: "c", result: failTls }]);
  assert.equal(s.ok, false);
  assert.equal(s.exit, 10);
});

// ---- whole program with injected fixture effects ----
const siteFiles = { "": siteHtml, "app.mjs": read("site/app.mjs"), "styles.css": read("site/styles.css"), "public-config.mjs": read("site/public-config.mjs"), "submission.mjs": read("site/submission.mjs") };
const fixtureGet = (overrides = {}) => async url => {
  if (overrides[url]) return overrides[url];
  const path = url.slice(CANONICAL_URL.length);
  return path in siteFiles
    ? { ok: true, value: { url, status: 200, headers: {}, body: siteFiles[path], tls: { authorized: true } } }
    : { ok: true, value: { url, status: 404, headers: {}, body: "", tls: { authorized: true } } };
};
const goodDns = async () => ({ ok: true, value: ["kemiller2002.github.io"] });
const now = () => new Date("2026-10-08T00:00:00Z");

test("verifyPublicSite passes against the committed site served from fixtures", async () => {
  const r = await verifyPublicSite({ resolve: goodDns, get: fixtureGet(), now });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.exit, 0);
  assert.deepEqual(r.checks.map(c => c.name), ["dns-cname", "tls-valid", "document-status", "canonical", "same-origin-assets", "no-github-io", "no-secrets"]);
});

test("verifyPublicSite fails closed for NXDOMAIN, proxy denial, missing asset and leaked secret", async () => {
  const nx = await verifyPublicSite({ resolve: async () => ({ ok: false, error: { code: "ENOTFOUND" } }), get: async () => ({ ok: false, error: { code: "ENOTFOUND" } }), now });
  assert.equal(nx.ok, false);
  assert.equal(nx.exit, Reason.DNS_NXDOMAIN.exit);

  const blocked = await verifyPublicSite({ resolve: goodDns, get: async () => ({ ok: false, error: { code: "PROXY_DENIED" } }), now });
  assert.equal(blocked.exit, Reason.NETWORK_BLOCKED.exit);

  const missing = await verifyPublicSite({ resolve: goodDns, get: fixtureGet({ [`${CANONICAL_URL}submission.mjs`]: { ok: true, value: { status: 404, headers: {}, body: "", tls: { authorized: true } } } }), now });
  assert.equal(missing.exit, Reason.ASSET_FAILED.exit, "transitively imported module must be fetched and checked");

  const leaked = ["AK", "IA", "Z".repeat(16)].join("");
  const secret = await verifyPublicSite({ resolve: goodDns, get: fixtureGet({ [`${CANONICAL_URL}public-config.mjs`]: { ok: true, value: { status: 200, headers: {}, body: `export const k="${leaked}"`, tls: { authorized: true } } } }), now });
  assert.equal(secret.exit, Reason.SECRET_FOUND.exit);

  const untrusted = await verifyPublicSite({ resolve: goodDns, get: fixtureGet({ [CANONICAL_URL]: { ok: true, value: { status: 200, headers: {}, body: siteHtml, tls: { authorized: false } } } }), now });
  assert.equal(untrusted.exit, Reason.TLS_INVALID.exit);
});
