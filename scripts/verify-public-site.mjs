#!/usr/bin/env node
// Read-only verification of the public Vitium site (VIT-NFR-003, VIT-AC-014, VIT-AC-015).
// It never writes anything, never changes DNS/Pages settings and sends only GET requests.
//
// Usage: node scripts/verify-public-site.mjs [--json] [--url https://vitium.echelonfoundry.com/]
//
// TLS is validated with Node's bundled default CA store (not the sandbox proxy CA),
// and requests are made directly (no HTTP proxy), so a result here reflects the
// public internet path. If direct egress is blocked, the run fails as
// NETWORK_BLOCKED / HTTPS_UNREACHABLE, which is NOT evidence that the site is down.
import { promises as dnsPromises } from "node:dns";
import https from "node:https";
import tls from "node:tls";
import {
  CANONICAL_HOST, CANONICAL_URL, EXPECTED_CNAME, ok, classifyNetworkError,
  evaluateCname, evaluateDocumentResponse, evaluateCanonical, evaluateNoGithubIo,
  extractSameOriginAssets, extractModuleImports, evaluateAssets, evaluateSecrets, summarize
} from "./lib/public-site-checks.mjs";

// ---- effects (injected) ----
const resolveCname = host => dnsPromises.resolveCname(host)
  .then(value => ({ ok: true, value }), error => ({ ok: false, error: { code: error.code || "UNKNOWN" } }));

const httpsGet = (url, { timeoutMs = 15000 } = {}) => new Promise(resolve => {
  const req = https.get(url, {
    ca: tls.rootCertificates, // Node's default public CA set only
    rejectUnauthorized: true,
    agent: false,
    timeout: timeoutMs,
    headers: { "user-agent": "vitium-verify-public-site/1 (read-only)" }
  }, res => {
    const chunks = [];
    const cert = res.socket.getPeerCertificate?.() || {};
    res.on("data", c => chunks.push(c));
    res.on("end", () => resolve({ ok: true, value: {
      url, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"),
      tls: { authorized: res.socket.authorized, validFrom: cert.valid_from, validTo: cert.valid_to, subjectAltName: cert.subjectaltname, issuer: cert.issuer?.O }
    } }));
  });
  req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
  req.on("error", error => resolve({ ok: false, error: { code: error.code || "UNKNOWN", message: error.message } }));
});

// ---- program (effects passed in) ----
export const verifyPublicSite = async ({ url = CANONICAL_URL, resolve = resolveCname, get = httpsGet, now = () => new Date() } = {}) => {
  const startedAt = now().toISOString();
  const host = new URL(url).hostname;
  const checks = [];
  checks.push({ name: "dns-cname", result: host === CANONICAL_HOST ? evaluateCname(await resolve(host), EXPECTED_CNAME) : ok("skipped: non-canonical host") });

  const doc = await get(url);
  if (!doc.ok) {
    checks.push({ name: "https-reachable", result: classifyNetworkError(doc.error) });
    return Object.freeze({ startedAt, url, ...summarize(checks) });
  }
  const { status, headers, body, tls: tlsInfo } = doc.value;
  checks.push({ name: "tls-valid", result: tlsInfo.authorized ? ok(tlsInfo) : classifyNetworkError({ code: "CERT_UNTRUSTED" }) });
  checks.push({ name: "document-status", result: evaluateDocumentResponse({ status, headers, url }) });
  checks.push({ name: "canonical", result: evaluateCanonical(body) });

  const assetUrls = extractSameOriginAssets(body, url);
  const fetched = [];
  const queue = [...assetUrls];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const next = queue.shift();
    const r = await get(next);
    fetched.push(r.ok ? { url: next, status: r.value.status, body: r.value.body } : { url: next, status: null, error: r.error.code });
    if (r.ok && /\.m?js($|\?)/.test(next)) {
      extractModuleImports(r.value.body, next).filter(u => !seen.has(u)).forEach(u => { seen.add(u); queue.push(u); });
    }
  }
  checks.push({ name: "same-origin-assets", result: evaluateAssets(fetched) });
  const texts = [{ url, body }, ...fetched.filter(f => typeof f.body === "string").map(f => ({ url: f.url, body: f.body }))];
  checks.push({ name: "no-github-io", result: evaluateNoGithubIo(texts.map(t => t.body).join("\n")) });
  checks.push({ name: "no-secrets", result: evaluateSecrets(texts) });
  return Object.freeze({ startedAt, url, ...summarize(checks) });
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1] : CANONICAL_URL;
  const report = await verifyPublicSite({ url: urlArg });
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`verify-public-site ${report.startedAt} ${report.url}`);
    report.checks.forEach(c => console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.ok ? "" : ` ${c.error.reason}: ${c.error.detail}`}`));
    console.log(report.ok ? "RESULT: all checks passed" : `RESULT: FAILED (exit ${report.exit})`);
  }
  process.exitCode = report.exit;
}
