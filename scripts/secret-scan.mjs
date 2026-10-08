#!/usr/bin/env node
// Read-only repository/publishable-artifact credential scan (VIT-NFR-004, VIT-AC-015).
// Usage: node scripts/secret-scan.mjs [root=.]   -> exit 1 on any non-allowlisted finding.
//
// Policy: strict. tests/ and generated governance directories (.conditor, .ros, .sde,
// .echelon, .visual-engineering, .communication-engineering, .github) are scanned.
// There is no inline-suppression mechanism: fake credentials in tests must be assembled at
// runtime (e.g. ["AK", "IA", "Q".repeat(16)].join("")) so the committed bytes never match.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { scanText, partitionFindings, isBinaryContent, EXCLUDED_DIRS } from "./lib/secret-scan.mjs";

// Explicit, documented allowlist of exact {path, patternId, reason}. Whole-file entries are
// not supported. Keep empty unless a real false positive is reviewed; stale entries fail.
export const ALLOWLIST = Object.freeze([]);

// listFiles :: (root, fsEffects) -> [relativePath]   (effects injected for testability)
export const listFiles = (root, fs = { readdirSync, statSync }) => {
  const walk = dir => fs.readdirSync(dir).flatMap(name => {
    if (EXCLUDED_DIRS.includes(name)) return [];
    const full = join(dir, name);
    return fs.statSync(full).isDirectory() ? walk(full) : [relative(root, full).split(sep).join("/")];
  });
  return walk(root);
};

// scanTree :: (root, { allowlist, readBytes }) -> { scanned, binary, scannedPaths, blocked, allowed, staleAllowlist }
export const scanTree = (root, { allowlist = ALLOWLIST, readBytes = p => readFileSync(p) } = {}) => {
  const entries = listFiles(root).map(path => ({ path, bytes: readBytes(join(root, path)) }));
  const text = entries.filter(e => !isBinaryContent(e.bytes));
  const binary = entries.filter(e => isBinaryContent(e.bytes)).map(e => e.path);
  const findings = text.flatMap(e => scanText(e.path, e.bytes.toString("utf8")));
  return Object.freeze({
    scanned: text.length,
    binary: Object.freeze(binary),
    scannedPaths: Object.freeze(text.map(e => e.path)),
    ...partitionFindings(findings, allowlist)
  });
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = process.argv[2] || ".";
  const { scanned, binary, blocked, allowed, staleAllowlist } = scanTree(root);
  console.log(`secret-scan: scanned ${scanned} text files (${binary.length} binary skipped), ${blocked.length} blocked, ${allowed.length} allowlisted, ${staleAllowlist.length} stale allowlist entries`);
  binary.forEach(p => console.log(`BINARY-SKIPPED ${p}`));
  blocked.forEach(f => console.log(`BLOCKED ${f.path}:${f.line} ${f.patternId} ${f.preview}`));
  process.exitCode = blocked.length > 0 || staleAllowlist.length > 0 ? 1 : 0;
}
