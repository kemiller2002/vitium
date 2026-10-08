#!/usr/bin/env node
// Read-only repository/publishable-artifact credential scan (VIT-NFR-004, VIT-AC-015).
// Usage: node scripts/secret-scan.mjs [root=.]   -> exit 1 on any non-allowlisted finding.
//
// Policy: strict. tests/ and generated governance directories (.conditor, .ros, .sde,
// .echelon, .visual-engineering, .communication-engineering, .github) are scanned.
// There is no inline-suppression mechanism: fake credentials in tests must be assembled at
// runtime (e.g. ["AK", "IA", "Q".repeat(16)].join("")) so the committed bytes never match.
//
// File source (VF-022): inside a git checkout the scanned set is exactly what git would
// publish or commit: tracked files plus untracked files that are NOT gitignored
// (`git ls-files --cached --others --exclude-standard`). Gitignored generated output
// (tests/browser/.output/, node_modules/, build dirs) is therefore not scanned, while a new
// file someone forgot to add IS scanned. Outside git, or when the scan root is itself
// ignored (e.g. `.aws-sam/build` scanned explicitly by CI), the filesystem walk is used.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { scanText, partitionFindings, isBinaryContent, EXCLUDED_DIRS } from "./lib/secret-scan.mjs";

// Explicit, documented allowlist of exact {path, patternId, reason}. Whole-file entries are
// not supported. Keep empty unless a real false positive is reviewed; stale entries fail.
export const ALLOWLIST = Object.freeze([]);

// listFiles :: (root, fsEffects) -> [relativePath]   (filesystem walk; effects injected)
export const listFiles = (root, fs = { readdirSync, statSync }) => {
  const walk = dir => fs.readdirSync(dir).flatMap(name => {
    if (EXCLUDED_DIRS.includes(name)) return [];
    const full = join(dir, name);
    return fs.statSync(full).isDirectory() ? walk(full) : [relative(root, full).split(sep).join("/")];
  });
  return walk(root);
};

// Git effect. Repository discovery is driven only by `root` (ambient GIT_* overrides removed).
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|PREFIX)$/.test(k)));
export const runGit = (root, args) => {
  try {
    return { ok: true, value: execFileSync("git", ["-C", root, ...args], { env: gitEnv(), stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString("utf8") };
  } catch (error) {
    return { ok: false, error: { code: error.status ?? error.code ?? "GIT_FAILED" } };
  }
};

// gitFileList :: (root, git) -> Result<[relativePath]>
// ok:false means "not usable" (not a checkout, or root itself ignored): caller falls back to the walk.
export const gitFileList = (root, git = runGit) => {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.value.trim() !== "true") return { ok: false, error: { code: "NOT_A_CHECKOUT" } };
  // `check-ignore` exits 0 when the path IS ignored.
  if (git(root, ["check-ignore", "-q", "--no-index", "."]).ok) return { ok: false, error: { code: "ROOT_IGNORED" } };
  const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (!listed.ok) return { ok: false, error: { code: "LS_FILES_FAILED" } };
  const paths = listed.value.split("\0").filter(Boolean)
    .filter(p => !p.split("/").some(seg => EXCLUDED_DIRS.includes(seg)))
    // --cached lists index entries whose working file may have been deleted.
    .filter(p => existsSync(join(root, p)) && statSync(join(root, p)).isFile());
  return { ok: true, value: Object.freeze([...new Set(paths)].sort()) };
};

// selectFiles :: (root, { git }) -> { source: "git" | "walk", files }
export const selectFiles = (root, { git = runGit } = {}) => {
  const fromGit = gitFileList(root, git);
  return fromGit.ok
    ? Object.freeze({ source: "git", files: fromGit.value })
    : Object.freeze({ source: "walk", files: Object.freeze(listFiles(root)), reason: fromGit.error.code });
};

// scanTree :: (root, { allowlist, readBytes, git }) -> { source, scanned, binary, scannedPaths, blocked, allowed, staleAllowlist }
export const scanTree = (root, { allowlist = ALLOWLIST, readBytes = p => readFileSync(p), git = runGit } = {}) => {
  const { source, files } = selectFiles(root, { git });
  const entries = files.map(path => ({ path, bytes: readBytes(join(root, path)) }));
  const text = entries.filter(e => !isBinaryContent(e.bytes));
  const binary = entries.filter(e => isBinaryContent(e.bytes)).map(e => e.path);
  const findings = text.flatMap(e => scanText(e.path, e.bytes.toString("utf8")));
  return Object.freeze({
    source,
    scanned: text.length,
    binary: Object.freeze(binary),
    scannedPaths: Object.freeze(text.map(e => e.path)),
    ...partitionFindings(findings, allowlist)
  });
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = process.argv[2] || ".";
  const { source, scanned, binary, blocked, allowed, staleAllowlist } = scanTree(root);
  console.log(`secret-scan [${source}]: scanned ${scanned} text files (${binary.length} binary skipped), ${blocked.length} blocked, ${allowed.length} allowlisted, ${staleAllowlist.length} stale allowlist entries`);
  binary.forEach(p => console.log(`BINARY-SKIPPED ${p}`));
  blocked.forEach(f => console.log(`BLOCKED ${f.path}:${f.line} ${f.patternId} ${f.preview}`));
  process.exitCode = blocked.length > 0 || staleAllowlist.length > 0 ? 1 : 0;
}
