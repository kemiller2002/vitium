#!/usr/bin/env node
// Read-only repository/publishable-artifact credential scan (VIT-NFR-004, VIT-AC-015).
// Usage: node scripts/secret-scan.mjs [root=.]   -> exit 1 on any non-allowlisted finding.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { scanText, partitionFindings, isScannablePath, EXCLUDED_DIRS } from "./lib/secret-scan.mjs";

// Explicit, documented allowlist. Each entry must state why the match is not a credential.
// Keep empty unless a real false positive is reviewed; stale entries fail the test suite.
export const ALLOWLIST = Object.freeze([]);

// listFiles :: (fsEffects, root) -> [relativePath]   (effects injected for testability)
export const listFiles = (root, fs = { readdirSync, statSync }) => {
  const walk = dir => fs.readdirSync(dir).flatMap(name => {
    if (EXCLUDED_DIRS.includes(name)) return [];
    const full = join(dir, name);
    return fs.statSync(full).isDirectory() ? walk(full) : [relative(root, full).split(sep).join("/")];
  });
  return walk(root);
};

export const scanTree = (root, { allowlist = ALLOWLIST, read = p => readFileSync(p, "utf8") } = {}) => {
  const files = listFiles(root).filter(isScannablePath);
  const findings = files.flatMap(path => scanText(path, read(join(root, path))));
  return Object.freeze({ scanned: files.length, ...partitionFindings(findings, allowlist) });
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = process.argv[2] || ".";
  const { scanned, blocked, allowed, staleAllowlist } = scanTree(root);
  console.log(`secret-scan: scanned ${scanned} files, ${blocked.length} blocked, ${allowed.length} allowlisted, ${staleAllowlist.length} stale allowlist entries`);
  blocked.forEach(f => console.log(`BLOCKED ${f.path}:${f.line} ${f.patternId} ${f.preview}`));
  process.exitCode = blocked.length > 0 || staleAllowlist.length > 0 ? 1 : 0;
}
