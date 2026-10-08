// VF-034 containment (VIT-VER-006/009, VIT-AC-036; DOM-001 s.29).
// The legacy `transition`/`tryTransition` shape in service/triage.mjs skips author
// independence and the human-verifier rule, because the user-authored tests
// tests/triage.test.mjs and tests/state-contract.test.mjs drive it with one actor that both
// submits and passes. Pending the owner's decision, it must be unreachable from production
// code, and anything it produces must be distinguishable and unusable as a verified basis.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tryTransition, transition } from "../service/triage.mjs";
import { table } from "../service/triage.mjs";
import { evaluateTransition } from "../service/lifecycle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_MODULE = resolve(root, "service/triage.mjs");
const LEGACY_EXPORTS = Object.freeze(["transition", "tryTransition"]);
const PRODUCTION_DIRS = Object.freeze(["service", "site"]); // includes service/machine, service/adapters

/** Pure: every .mjs/.js file under a directory (recursive). */
const listModules = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? listModules(path) : /\.(mjs|js)$/.test(name) ? [path] : [];
});

/**
 * Pure: the bindings a source text imports from each specifier. Covers named imports
 * (incl. `as` aliases), namespace imports, default imports, side-effect/re-export forms
 * (`export ... from`) and dynamic `import("...")`. Namespace, re-export-all and dynamic
 * imports return "*" (they can reach every export).
 */
export function importsOf(source) {
  const found = [];
  const stat = /(?:^|[;\n])\s*(import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of source.matchAll(stat)) {
    const clause = m[2];
    const names = /\*/.test(clause) ? ["*"]
      : [...(clause.match(/\{([\s\S]*?)\}/)?.[1] ?? "").split(",")].map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
        .concat(/^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.trim()) && m[1] === "import" ? ["default"] : []);
    found.push({ specifier: m[3], names });
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: m[1], names: ["*"] });
  for (const m of source.matchAll(/\bimport\s*\(\s*([^"'\s)][^)]*)\)/g)) found.push({ specifier: "<computed>", names: ["*"], expr: m[1] });
  return found;
}

/** Pure: does a module's import list reach a legacy export of service/triage.mjs? */
export function reachesLegacy(file, source) {
  return importsOf(source).filter(({ specifier, names }) => {
    const target = specifier === "<computed>" ? null : resolve(dirname(file), specifier);
    const computed = specifier === "<computed>";
    return (computed || target === LEGACY_MODULE) && names.some(n => n === "*" || LEGACY_EXPORTS.includes(n));
  });
}

test("VF-034: no production module (service/, service/machine/, service/adapters/, site/) imports the legacy lifecycle entry point", () => {
  const offenders = [];
  for (const dir of PRODUCTION_DIRS) {
    for (const file of listModules(join(root, dir))) {
      if (file === LEGACY_MODULE) continue;
      const hits = reachesLegacy(file, readFileSync(file, "utf8"));
      if (hits.length) offenders.push(relative(root, file) + " -> " + JSON.stringify(hits));
    }
  }
  assert.deepEqual(offenders, [], "production code reaches the deprecated legacy lifecycle shape");
  // Control: the scan actually saw the modules that are allowed to import triage.mjs.
  assert.ok(listModules(join(root, "service")).some(f => f.endsWith("triage-cli.mjs")));
  assert.ok(listModules(join(root, "service")).some(f => f.includes("/machine/")));
});

test("VF-034: the import scanner detects every way a module could reach the legacy export (mutation proof)", () => {
  const file = join(root, "service/new-module.mjs");
  const machineFile = join(root, "service/machine/x.mjs");
  const siteFile = join(root, "site/x.mjs");
  const positives = [
    [file, 'import { transition } from "./triage.mjs";'],
    [file, 'import { table, tryTransition } from "./triage.mjs";'],
    [file, 'import { tryTransition as t } from "./triage.mjs";'],
    [file, 'import * as triage from "./triage.mjs";'],
    [file, 'export { transition } from "./triage.mjs";'],
    [file, 'export * from "./triage.mjs";'],
    [file, 'const m = await import("./triage.mjs");'],
    [file, 'const m = await import(path);'],
    [machineFile, 'import {\n  transition\n} from "../triage.mjs";'],
    [siteFile, "import { tryTransition } from '../service/triage.mjs';"]
  ];
  for (const [f, src] of positives) assert.ok(reachesLegacy(f, src).length > 0, "missed: " + src);
  const negatives = [
    [file, 'import { table } from "./triage.mjs";'],
    [file, 'import { transition } from "./lifecycle.mjs";'],
    [siteFile, 'import { transition } from "./state.mjs";'],
    [file, '// import { transition } from "./elsewhere.mjs";']
  ];
  for (const [f, src] of negatives) assert.equal(reachesLegacy(f, src).length, 0, "false positive: " + src);
});

const ts = "2026-10-08T12:00:00.000Z";
const legacyCmd = (to, o = {}) => ({ to, actor: "operator-1", role: "triager", reason: "r", expectedRevision: 0, occurredAt: ts, ...o });

test("VF-034: every event emitted by the legacy entry point is marked legacyUnguarded", () => {
  const sub = transition({ kind: "defect", state: "in-progress", revision: 0, history: [] },
    legacyCmd("awaiting-verification", { attemptId: "a1", candidateRevision: "c1", evidenceId: "req-1" }));
  const res = transition(sub, legacyCmd("resolved", { role: "verifier", expectedRevision: 1, attemptId: "a1", candidateRevision: "c1", evidenceId: "run-1", verificationOutcome: "passed" }));
  assert.deepEqual(res.history.map(e => e.legacyUnguarded), [true, true]);
  // Mixed and typed command shapes through the same legacy entry point are marked too.
  const typed = tryTransition({ kind: "defect", state: "new", revision: 0, history: [] }, { ...legacyCmd("triaged"), fields: {} });
  assert.equal(typed.value.event.legacyUnguarded, true);
  // The strict API never sets it.
  const strict = evaluateTransition(table, { kind: "defect", state: "new", revision: 0, history: [] },
    { ...legacyCmd("triaged"), provenance: "authenticated-human" }, { context: { provenance: "authenticated-human" } });
  assert.equal(strict.value.event.legacyUnguarded, undefined);
});

test("VF-034: the strict path refuses to close a resolution produced by the legacy entry point; reopen + strict re-verification is the way out", () => {
  const human = { context: { provenance: "authenticated-human" } };
  const sub = transition({ kind: "defect", id: "DEF-0777", state: "in-progress", revision: 0, history: [] },
    legacyCmd("awaiting-verification", { attemptId: "a1", candidateRevision: "c1", evidenceId: "req-1" }));
  const resolved = transition(sub, legacyCmd("resolved", { role: "verifier", expectedRevision: 1, attemptId: "a1", candidateRevision: "c1", evidenceId: "run-1", verificationOutcome: "passed" }));
  const close = { to: "closed", actor: "lead", role: "triager", reason: "done", occurredAt: ts, expectedRevision: 2, evidence: [{ kind: "verification-run", ref: "run-1" }] };
  const refused = evaluateTransition(table, resolved, close, human);
  assert.equal(refused.error?.code, "unverified_resolution");
  // Reopening (withdrawing the unguarded resolution) is allowed, then strict verification.
  let r = evaluateTransition(table, resolved, { to: "reopened", actor: "lead", role: "triager", reason: "re-verify", occurredAt: ts, expectedRevision: 2, evidence: [{ kind: "triage-correction", ref: "vf-034" }] }, human).value.record;
  r = evaluateTransition(table, r, { to: "in-progress", actor: "lead", role: "triager", reason: "rework", occurredAt: ts, expectedRevision: 3, fields: { attemptId: "a2", workItemId: "WI-1" } }, human).value.record;
  r = evaluateTransition(table, r, { to: "awaiting-verification", actor: "dev-1", role: "triager", reason: "submit", occurredAt: ts, expectedRevision: 4, fields: { attemptId: "a3", candidateRevision: "c3" }, evidence: [{ kind: "verification-request", ref: "req-3" }] }, human).value.record;
  r = evaluateTransition(table, r, { to: "resolved", actor: "qa-2", role: "verifier", reason: "pass", occurredAt: ts, expectedRevision: 5, fields: { attemptId: "a3", candidateRevision: "c3" }, evidence: [{ kind: "verification-run", ref: "run-3" }] }, human).value.record;
  const closed = evaluateTransition(table, r, { ...close, expectedRevision: 6, evidence: [{ kind: "verification-run", ref: "run-3" }] }, human);
  assert.equal(closed.ok, true, JSON.stringify(closed.error));
  assert.equal(closed.value.record.history.filter(e => e.legacyUnguarded).length, 2, "the legacy events stay in history, still marked");
});
