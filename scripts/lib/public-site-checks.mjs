// Pure evaluation functions for the public-site verifier (VIT-NFR-003, VIT-AC-014, VIT-AC-015).
// Every function here is total and side-effect free; network effects live in
// scripts/verify-public-site.mjs and are injected as parameters.
import { scanText } from "./secret-scan.mjs";

export const CANONICAL_ORIGIN = "https://vitium.echelonfoundry.com";
export const CANONICAL_URL = `${CANONICAL_ORIGIN}/`;
export const CANONICAL_HOST = "vitium.echelonfoundry.com";
export const EXPECTED_CNAME = "kemiller2002.github.io";

// Typed failure reasons. Exit code is stable per reason so automation can branch on it.
export const Reason = Object.freeze({
  DNS_NXDOMAIN: { code: "DNS_NXDOMAIN", exit: 10 },
  DNS_LOOKUP_FAILED: { code: "DNS_LOOKUP_FAILED", exit: 11 },
  DNS_WRONG_TARGET: { code: "DNS_WRONG_TARGET", exit: 12 },
  NETWORK_BLOCKED: { code: "NETWORK_BLOCKED", exit: 19 },
  HTTPS_UNREACHABLE: { code: "HTTPS_UNREACHABLE", exit: 20 },
  TLS_INVALID: { code: "TLS_INVALID", exit: 21 },
  HTTP_STATUS: { code: "HTTP_STATUS", exit: 22 },
  REDIRECT_OFFSITE: { code: "REDIRECT_OFFSITE", exit: 23 },
  CANONICAL_MISSING: { code: "CANONICAL_MISSING", exit: 30 },
  CANONICAL_MISMATCH: { code: "CANONICAL_MISMATCH", exit: 31 },
  GITHUB_IO_REFERENCE: { code: "GITHUB_IO_REFERENCE", exit: 32 },
  ASSET_FAILED: { code: "ASSET_FAILED", exit: 40 },
  SECRET_FOUND: { code: "SECRET_FOUND", exit: 50 }
});

export const ok = value => Object.freeze({ ok: true, value });
export const fail = (reason, detail) => Object.freeze({ ok: false, error: Object.freeze({ reason: reason.code, exit: reason.exit, detail }) });

const normHost = h => String(h || "").trim().toLowerCase().replace(/\.$/, "");

// evaluateCname :: (lookupResult, expected) -> Result
// lookupResult is { ok:true, value:[targets] } | { ok:false, error:{ code } } from the DNS effect.
export const evaluateCname = (lookup, expected = EXPECTED_CNAME) => {
  if (!lookup.ok) {
    return ["ENOTFOUND", "ENODATA", "NXDOMAIN"].includes(lookup.error.code)
      ? fail(Reason.DNS_NXDOMAIN, `No CNAME for ${CANONICAL_HOST} (${lookup.error.code})`)
      : fail(Reason.DNS_LOOKUP_FAILED, `DNS lookup error ${lookup.error.code}`);
  }
  const targets = lookup.value.map(normHost);
  if (targets.length !== 1) return fail(Reason.DNS_WRONG_TARGET, `Expected exactly one CNAME, got ${JSON.stringify(targets)}`);
  return targets[0] === normHost(expected)
    ? ok(targets[0])
    : fail(Reason.DNS_WRONG_TARGET, `CNAME ${targets[0]} != ${expected}`);
};

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_REVOKED", "CERT_UNTRUSTED", "ERR_SSL_WRONG_VERSION_NUMBER"
]);

// classifyNetworkError :: { code, message } -> Result(fail)
export const classifyNetworkError = err => {
  const code = err?.code || "UNKNOWN";
  if (TLS_CODES.has(code)) return fail(Reason.TLS_INVALID, `TLS validation failed: ${code}`);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return fail(Reason.DNS_NXDOMAIN, `Host did not resolve: ${code}`);
  if (code === "PROXY_DENIED") return fail(Reason.NETWORK_BLOCKED, "Egress proxy refused the connection; result is NOT evidence about the site");
  return fail(Reason.HTTPS_UNREACHABLE, `HTTPS request failed: ${code}`);
};

const isGithubIo = url => /(^|\.)github\.io$/i.test(safeHost(url));
function safeHost(url) { try { return new URL(url).hostname; } catch { return ""; } }

// evaluateDocumentResponse :: { status, headers, url } -> Result
export const evaluateDocumentResponse = ({ status, headers = {}, url = CANONICAL_URL }) => {
  const location = headers.location;
  if (status >= 300 && status < 400) {
    const target = location ? new URL(location, url).href : "";
    return isGithubIo(target) || safeHost(target) !== CANONICAL_HOST
      ? fail(Reason.REDIRECT_OFFSITE, `Redirect ${status} to ${target || "(no location)"}`)
      : fail(Reason.HTTP_STATUS, `Unexpected same-host redirect ${status} to ${target}`);
  }
  return status === 200 ? ok(status) : fail(Reason.HTTP_STATUS, `Status ${status} for ${url}`);
};

// Attribute extraction is intentionally simple: the site is static, hand-authored HTML.
const tagAttrs = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(m =>
    Object.fromEntries([...m[0].matchAll(/([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)]
      .map(a => [a[1].toLowerCase(), a[3] ?? a[4]])));

export const extractCanonical = html =>
  tagAttrs(html, "link").filter(a => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical")).map(a => a.href);

// evaluateCanonical :: html -> Result
export const evaluateCanonical = html => {
  const found = extractCanonical(html);
  if (found.length === 0) return fail(Reason.CANONICAL_MISSING, "No <link rel=canonical>");
  if (found.length > 1) return fail(Reason.CANONICAL_MISMATCH, `Multiple canonical links: ${found.join(", ")}`);
  return found[0] === CANONICAL_URL ? ok(found[0]) : fail(Reason.CANONICAL_MISMATCH, `Canonical ${found[0]} != ${CANONICAL_URL}`);
};

// evaluateNoGithubIo :: html -> Result  (canonical/og/meta-refresh/any absolute URL)
export const evaluateNoGithubIo = text => {
  const hits = [...text.matchAll(/https?:\/\/[a-z0-9.-]*github\.io\b[^\s"'<>]*/gi)].map(m => m[0]);
  return hits.length === 0 ? ok(true) : fail(Reason.GITHUB_IO_REFERENCE, `github.io reference(s): ${[...new Set(hits)].join(", ")}`);
};

// Same-origin assets referenced by script[src], link[href] (stylesheet/icon/modulepreload), img[src].
// Also follows static `import ... from "./x.mjs"` in fetched JS when callers pass module sources.
export const extractSameOriginAssets = (html, pageUrl = CANONICAL_URL) => {
  const origin = new URL(pageUrl).origin;
  const refs = [
    ...tagAttrs(html, "script").map(a => a.src),
    ...tagAttrs(html, "link").filter(a => /(stylesheet|icon|modulepreload|manifest)/i.test(a.rel || "")).map(a => a.href),
    ...tagAttrs(html, "img").map(a => a.src)
  ].filter(Boolean);
  const resolved = refs.map(r => { try { return new URL(r, pageUrl); } catch { return null; } }).filter(Boolean);
  return Object.freeze([...new Set(resolved.filter(u => u.origin === origin).map(u => u.href))]);
};

// Static imports, side-effect imports, `export ... from` re-exports and literal dynamic import().
const MODULE_SPECIFIER_PATTERNS = Object.freeze([
  /\bimport\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:\*|\*\s+as\s+\w+|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
]);
export const extractModuleImports = (js, moduleUrl) =>
  Object.freeze([...new Set(MODULE_SPECIFIER_PATTERNS.flatMap(re => [...js.matchAll(re)])
    .map(m => m[1]).filter(s => s.startsWith("./") || s.startsWith("../") || s.startsWith("/"))
    .map(s => new URL(s, moduleUrl).href))]);

// evaluateAssets :: [{ url, status }] -> Result
export const evaluateAssets = results => {
  const bad = results.filter(r => r.status !== 200);
  return bad.length === 0
    ? ok(results.map(r => r.url))
    : fail(Reason.ASSET_FAILED, bad.map(r => `${r.url} -> ${r.status ?? r.error}`).join("; "));
};

// evaluateSecrets :: [{ url, body }] -> Result
export const evaluateSecrets = documents => {
  const findings = documents.flatMap(d => scanText(d.url, d.body));
  return findings.length === 0
    ? ok(documents.length)
    : fail(Reason.SECRET_FOUND, findings.map(f => `${f.path}:${f.line} ${f.patternId} ${f.preview}`).join("; "));
};

// firstFailure :: [Result] -> Result
export const summarize = checks => {
  const failures = checks.filter(c => !c.result.ok);
  return Object.freeze({
    ok: failures.length === 0,
    exit: failures.length === 0 ? 0 : failures[0].result.error.exit,
    checks: checks.map(c => Object.freeze({ name: c.name, ok: c.result.ok, ...(c.result.ok ? { value: c.result.value } : { error: c.result.error }) }))
  });
};
