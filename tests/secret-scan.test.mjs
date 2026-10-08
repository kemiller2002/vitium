// VIT-NFR-004 / VIT-AC-015: publishable artifacts and tracked source contain no credentials.
// Fake canaries are assembled at runtime so that no tracked file contains a matching literal.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanText, partitionFindings, SECRET_PATTERNS } from "../scripts/lib/secret-scan.mjs";
import { scanTree, listFiles, ALLOWLIST } from "../scripts/secret-scan.mjs";
import { publicIntake } from "../site/public-config.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const j = (...parts) => parts.join("");
const rep = (ch, n) => ch.repeat(n);

// One synthetic canary per pattern. None of these is a real credential.
const CANARIES = Object.freeze({
  "github-classic-token": j("gh", "p_", rep("A", 36)),
  "github-fine-grained-pat": j("github", "_pat_", rep("B", 30)),
  "aws-access-key-id": j("AK", "IA", rep("Q", 16)),
  "aws-secret-access-key": j("aws_secret", "_access_key = ", rep("x", 40)),
  "private-key-block": j("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
  "turnstile-key-value": j("0x4", "AAAAAAA", "bcdEFGhijkLMN"),
  "bearer-token": j("Authorization: Bea", "rer ", rep("z", 32)),
  "url-embedded-credentials": j("https://", "operator:", "hunter2", "@", "example.invalid/path"),
  "slack-token": j("xo", "xb-", "1234567890-abcdef")
});

test("every scanner pattern has a canary and detects it", () => {
  assert.deepEqual(Object.keys(CANARIES).sort(), SECRET_PATTERNS.map(p => p.id).sort());
  for (const [id, canary] of Object.entries(CANARIES)) {
    const hits = scanText("canary.txt", `prefix\n${canary}\nsuffix`);
    assert.ok(hits.some(h => h.patternId === id), `pattern ${id} missed its canary`);
    assert.ok(hits.every(h => !h.preview.includes(canary)), "findings must not echo the full secret");
    assert.equal(hits.find(h => h.patternId === id).line, 2);
  }
});

test("scanner does not flag ordinary text that only resembles credentials", () => {
  const benign = [
    "Use a GitHub token stored in Secrets Manager; never ghp_ in source.",
    "https://example.com/path?token=secret#private",
    "Bearer tokens are rejected.",
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:name",
    "AKIA is the prefix of AWS long-term key ids",
    "mailto:security@example.invalid",
    "git@github.com:kemiller2002/vitium.git"
  ].join("\n");
  assert.deepEqual(scanText("benign.md", benign), []);
});

test("scanTree fails on a temp tree containing a fake canary and passes once removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "vitium-secret-scan-"));
  try {
    mkdirSync(join(dir, "site"));
    writeFileSync(join(dir, "site", "index.html"), "<p>clean</p>");
    writeFileSync(join(dir, "site", "app.mjs"), `export const k = "${CANARIES["github-classic-token"]}";`);
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "ignored.js"), CANARIES["aws-access-key-id"]);
    const dirty = scanTree(dir, { allowlist: [] });
    assert.equal(dirty.blocked.length, 1);
    assert.equal(dirty.blocked[0].path, "site/app.mjs");
    assert.equal(dirty.blocked[0].patternId, "github-classic-token");
    writeFileSync(join(dir, "site", "app.mjs"), "export const k = '';");
    assert.equal(scanTree(dir, { allowlist: [] }).blocked.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("files are scanned by content, not extension: unusual text formats are scanned, binaries reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "vitium-secret-scan-ext-"));
  try {
    mkdirSync(join(dir, ".ros", "events"), { recursive: true });
    writeFileSync(join(dir, ".ros", "events", "events.jsonl"), `{"e":"${CANARIES["aws-access-key-id"]}"}\n`);
    writeFileSync(join(dir, "launch.ps1"), `$t = "${CANARIES["github-classic-token"]}"`);
    writeFileSync(join(dir, "Directory.Build.props"), `<P>${CANARIES["url-embedded-credentials"]}</P>`);
    writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const r = scanTree(dir, { allowlist: [] });
    assert.deepEqual(r.blocked.map(f => f.path).sort(), [".ros/events/events.jsonl", "Directory.Build.props", "launch.ps1"]);
    assert.deepEqual(r.binary, ["logo.png"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no inline suppression exists: an annotated literal still fails", () => {
  const annotated = `const k = "${CANARIES["aws-access-key-id"]}"; // secret-scan: allow canary test fixture`;
  assert.equal(scanText("tests/x.test.mjs", annotated).length, 1);
  assert.equal(partitionFindings(scanText("tests/x.test.mjs", annotated), []).blocked.length, 1);
});

test("allowlist must be exact (path + pattern) and stale entries are reported", () => {
  const findings = scanText("tests/x.mjs", CANARIES["aws-access-key-id"]);
  const exact = partitionFindings(findings, [{ path: "tests/x.mjs", patternId: "aws-access-key-id", reason: "documented canary" }]);
  assert.equal(exact.blocked.length, 0);
  const wrongPath = partitionFindings(findings, [{ path: "tests/y.mjs", patternId: "aws-access-key-id", reason: "x" }]);
  assert.equal(wrongPath.blocked.length, 1);
  assert.equal(wrongPath.staleAllowlist.length, 1);
});

test("published site/ tree contains no credential patterns (what Pages uploads)", () => {
  const siteFiles = listFiles(join(repoRoot, "site"));
  assert.ok(siteFiles.includes("index.html") && siteFiles.includes("public-config.mjs"), "scan must actually cover site/");
  const result = scanTree(join(repoRoot, "site"), { allowlist: [] });
  assert.deepEqual(result.blocked, [], JSON.stringify(result.blocked));
});

test("repository source contains no credential patterns outside the documented allowlist", () => {
  const result = scanTree(repoRoot);
  assert.ok(result.scanned >= 30, `expected to scan the repository, scanned ${result.scanned}`);
  // Coverage guard: tests/ and generated governance/workflow directories are scanned when present.
  const covered = dirName => result.scannedPaths.some(p => p.startsWith(dirName + "/"));
  for (const d of ["tests", "site", "service", ".github"]) assert.ok(covered(d), `${d}/ must be scanned`);
  for (const d of [".conditor", ".ros", ".sde", ".echelon", ".visual-engineering", ".communication-engineering"]) {
    if (existsSync(join(repoRoot, d))) assert.ok(covered(d), `generated ${d}/ must be scanned`);
  }
  assert.ok(result.scannedPaths.every(p => !p.startsWith("node_modules/") && !p.startsWith(".git/")));
  assert.deepEqual(result.blocked, [], JSON.stringify(result.blocked));
  assert.deepEqual(result.staleAllowlist, [], "remove allowlist entries that no longer match");
  assert.ok(ALLOWLIST.every(a => typeof a.reason === "string" && a.reason.length > 10), "every allowlist entry needs a reason");
});

test("site/public-config.mjs stays disabled and holds no secret-like value", () => {
  assert.equal(publicIntake.enabled, false);
  assert.ok(Object.isFrozen(publicIntake));
  assert.deepEqual(Object.keys(publicIntake).sort(), ["enabled", "endpoint", "turnstileSiteKey"]);
  assert.equal(publicIntake.endpoint, "");
  assert.equal(publicIntake.turnstileSiteKey, "");
  const source = readFileSync(join(repoRoot, "site", "public-config.mjs"), "utf8");
  assert.match(source, /enabled:\s*false/);
  assert.doesNotMatch(source, /secret\s*:/i, "no secret-named property may exist in public config");
  assert.deepEqual(scanText("site/public-config.mjs", source), []);
});
