// VIT-NFR-003 / VIT-AC-014 / VIT-AC-015: pure parts of scripts/verify-public-site.mjs.
// No network: every effect is injected with fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

// Expected asset set is DERIVED from the committed site by following references
// from index.html through every same-origin module import, so new modules do not
// require editing this test. Independent guard: every committed site file other
// than index.html must be reachable (no orphaned/unchecked published file), and the
// known core assets must be in the closure.
const SITE_DIR = new URL("../site/", import.meta.url);
const committedSiteFiles = readdirSync(SITE_DIR).filter(f => statSync(new URL(f, SITE_DIR)).isFile()).sort();
const crawlCommittedSite = () => {
  const roots = extractSameOriginAssets(siteHtml, CANONICAL_URL);
  const step = (seen, queue) => {
    if (queue.length === 0) return seen;
    const [next, ...rest] = queue;
    const rel = next.slice(CANONICAL_URL.length);
    const found = /\.m?js$/.test(rel) ? extractModuleImports(read("site/" + rel), next).filter(u => !seen.includes(u)) : [];
    return step([...seen, ...found], [...rest, ...found]);
  };
  return Object.freeze(step([...roots], [...roots]).sort());
};

test("asset closure derived from the committed site covers every published file and ignores the CDN", () => {
  const closure = crawlCommittedSite();
  const expected = committedSiteFiles.filter(f => f !== "index.html").map(f => CANONICAL_URL + f).sort();
  assert.deepEqual(closure, expected, "every committed site file must be referenced (and every reference must exist)");
  for (const core of ["app.mjs", "styles.css", "submission.mjs", "public-config.mjs"]) {
    assert.ok(closure.includes(CANONICAL_URL + core), `core asset ${core} missing from closure`);
  }
  assert.ok(closure.every(a => a.startsWith(CANONICAL_URL)), "only same-origin assets");
  assert.ok(extractSameOriginAssets(siteHtml, CANONICAL_URL).every(a => !a.includes("cdn.jsdelivr.net")));
  assert.deepEqual(extractModuleImports('import x from "https://cdn.example/x.js"; import "./y.mjs";', `${CANONICAL_URL}a.mjs`), [`${CANONICAL_URL}y.mjs`]);
  assert.deepEqual(
    [...extractModuleImports('import {a} from "./b.mjs";\nexport { c } from "./d.mjs";\nexport * from "../e.mjs";\nconst f = await import("./f.mjs");', `${CANONICAL_URL}x/a.mjs`)].sort(),
    [`${CANONICAL_URL}e.mjs`, `${CANONICAL_URL}x/b.mjs`, `${CANONICAL_URL}x/d.mjs`, `${CANONICAL_URL}x/f.mjs`]);
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
// Serve every committed site file from disk; anything else is 404.
const siteFiles = Object.freeze(Object.fromEntries([["", siteHtml], ...committedSiteFiles.filter(f => f !== "index.html").map(f => [f, read("site/" + f)])]));
const served = (url, body, status = 200, authorized = true) => ({ ok: true, value: { url, status, headers: {}, body, tls: { authorized } } });
const fixtureGet = (overrides = {}) => async url => {
  if (overrides[url]) return overrides[url];
  const path = url.slice(CANONICAL_URL.length);
  return path in siteFiles ? served(url, siteFiles[path]) : served(url, "", 404);
};
const failedChecks = r => r.checks.filter(c => !c.ok).map(c => c.name);
const goodDns = async () => ({ ok: true, value: ["kemiller2002.github.io"] });
const now = () => new Date("2026-10-08T00:00:00Z");

test("verifyPublicSite passes against the committed site served from fixtures", async () => {
  const r = await verifyPublicSite({ resolve: goodDns, get: fixtureGet(), now });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.exit, 0);
  assert.deepEqual(r.checks.map(c => c.name), ["dns-cname", "tls-valid", "document-status", "canonical", "same-origin-assets", "no-github-io", "no-secrets"]);
});

test("verifyPublicSite fails closed; each fixture isolates exactly one fault", async () => {
  const nx = await verifyPublicSite({ resolve: async () => ({ ok: false, error: { code: "ENOTFOUND" } }), get: async () => ({ ok: false, error: { code: "ENOTFOUND" } }), now });
  assert.equal(nx.ok, false);
  assert.equal(nx.exit, Reason.DNS_NXDOMAIN.exit);

  const blocked = await verifyPublicSite({ resolve: goodDns, get: async () => ({ ok: false, error: { code: "PROXY_DENIED" } }), now });
  assert.equal(blocked.exit, Reason.NETWORK_BLOCKED.exit);
  assert.deepEqual(failedChecks(blocked), ["https-reachable"]);

  // submission.mjs is only reachable transitively (index.html -> app.mjs -> state.mjs -> submission.mjs).
  assert.doesNotMatch(read("site/app.mjs"), /from\s+["']\.\/submission\.mjs["']/, "fixture premise: submission.mjs must be a transitive import");
  const missing = await verifyPublicSite({ resolve: goodDns, get: fixtureGet({ [`${CANONICAL_URL}submission.mjs`]: served(`${CANONICAL_URL}submission.mjs`, "", 404) }), now });
  assert.equal(missing.exit, Reason.ASSET_FAILED.exit, "transitively imported module must be fetched and checked");
  assert.deepEqual(failedChecks(missing), ["same-origin-assets"]);

  // Keep the real module content (so its imports and the asset check stay green) and append a leaked key.
  const leaked = ["AK", "IA", "Z".repeat(16)].join("");
  const configUrl = `${CANONICAL_URL}public-config.mjs`;
  const secret = await verifyPublicSite({ resolve: goodDns, get: fixtureGet({ [configUrl]: served(configUrl, `${siteFiles["public-config.mjs"]}\nexport const k="${leaked}";`) }), now });
  assert.equal(secret.exit, Reason.SECRET_FOUND.exit);
  assert.deepEqual(failedChecks(secret), ["no-secrets"]);
  assert.ok(!JSON.stringify(secret).includes(leaked), "report must not echo the leaked value");

  const untrusted = await verifyPublicSite({ resolve: goodDns, get: fixtureGet({ [CANONICAL_URL]: served(CANONICAL_URL, siteHtml, 200, false) }), now });
  assert.equal(untrusted.exit, Reason.TLS_INVALID.exit);
  assert.deepEqual(failedChecks(untrusted), ["tls-valid"]);
});
