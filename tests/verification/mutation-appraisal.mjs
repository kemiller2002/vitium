#!/usr/bin/env node
// Mutation-sensitivity appraisal (VIT-VER-003, VIT-AC-023 precursor).
// Each mutant is applied to a throw-away COPY of the repository under a scratch
// directory; the working tree is never modified. For every mutant we run the
// selected suites in the copy and record whether any test failed ("killed").
//
// Usage: node tests/verification/mutation-appraisal.mjs --scratch=<dir> [--suites=unit,adversarial,browser] [--only=M1,M2]
// Output: JSON lines on stdout plus <scratch>/mutation-results.json
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Each mutant: a plausible wrong implementation of an important guard. */
export const MUTANTS = Object.freeze([
  { id: "M01", guard: "Legacy URL sanitisation keeps query/fragment", req: "VIT-REP-007 / VIT-AC-008", file: "site/submission.mjs",
    from: "pageUrl = parsed.origin + parsed.pathname;", to: "pageUrl = parsed.href;" },
  { id: "M02", guard: "Legacy URL scheme allowlist removed", req: "VIT-API-002 / VIT-AC-004", file: "site/submission.mjs",
    from: 'if (!["http:", "https:"].includes(parsed.protocol)) {', to: "if (false) {" },
  { id: "M03", guard: "Service URL sanitisation keeps query/fragment", req: "VIT-API-002 / VIT-AC-008", file: "service/report-domain.mjs",
    from: "pageUrl = url.origin + url.pathname;", to: "pageUrl = url.href;" },
  { id: "M04", guard: "Idempotency conflict check removed (altered body replays old receipt)", req: "VIT-API-004 / VIT-AC-006", file: "service/intake.mjs",
    from: "if (!accepted || accepted.payloadHash !== hash) {", to: "if (!accepted) {" },
  { id: "M05", guard: "Challenge verified AFTER store (store-before-challenge)", req: "VIT-API-003 / VIT-AC-005", file: "service/intake.mjs",
    from: "      let verified = false;\n      try { verified = await verifyChallenge(challengeToken); }",
    to: "      let verified = false;\n      await store.putOnce({pk:\"REQUEST#\"+key,reference:reference(),payloadHash:payloadHash(report),report,receivedAt:now()}).catch(()=>{});\n      try { verified = await verifyChallenge(challengeToken); }" },
  { id: "M06", guard: "Truthy (non-boolean) challenge result accepted", req: "VIT-API-003", file: "service/intake.mjs",
    from: "if (verified !== true) throw", to: "if (!verified) throw" },
  { id: "M07", guard: "Receipt issued although store reply is malformed", req: "VIT-API-005 / VIT-AC-007", file: "service/intake.mjs",
    from: "      if (!result || typeof result.created !== \"boolean\") {", to: "      if (false) {" },
  { id: "M08", guard: "Store failure swallowed and treated as created", req: "VIT-API-005 / VIT-AC-007", file: "service/intake.mjs",
    from: "      try { result = await store.putOnce(item); }\n      catch { throw new IntakeError(\"storage_unavailable\",503,\"The report could not be saved. Please retry.\"); }",
    to: "      try { result = await store.putOnce(item); }\n      catch { result = {created:true}; }" },
  { id: "M09", guard: "Illegal transition refusal removed", req: "VIT-LCY-001 / VIT-AC-012", file: "service/triage.mjs",
    from: 'if (!targets.includes(command.to)) throw new TransitionError("Transition not permitted.");', to: "" },
  { id: "M10", guard: "Resolution no longer requires verifier role", req: "VIT-LCY-004 / VIT-VER-006", file: "service/triage.mjs",
    from: '(command.role!=="verifier" && command.role!=="administrator" || !command.evidenceId)', to: "(!command.evidenceId)" },
  { id: "M11", guard: "Product list mismatch (service gains an unknown product)", req: "VIT-DOM-004 / VIT-AC-010", file: "service/report-domain.mjs",
    from: '"Forma Studio", "HelixNote", "Ordo", "Praxis", "Signal", "Summa", "Other / not sure"',
    to: '"Forma Studio", "HelixNote", "Ordo", "Praxis", "Signal", "Summa", "Vitium", "Other / not sure"' },
  { id: "M12", guard: "Product mismatch only in site HTML <select>", req: "VIT-DOM-004 / VIT-AC-010", file: "site/index.html",
    from: "<option>Summa</option>", to: "<option>Summa</option><option>Vitium</option>" },
  { id: "M13", guard: "Origin check uses suffix match", req: "VIT-API-001", file: "service/http.mjs",
    from: "if (origin !== allowedOrigin) return", to: "if (!String(origin).endsWith(\"vitium.echelonfoundry.com\")) return" },
  { id: "M14", guard: "Unexpected-property refusal removed", req: "VIT-API-002 / VIT-AC-004", file: "service/report-domain.mjs",
    from: 'if (!allowed.has(key)) refuse("Unexpected report field.");', to: "" },
  { id: "M15", guard: "Body size limit counts characters not bytes", req: "VIT-API-002 / VIT-AC-005", file: "service/http.mjs",
    from: 'Buffer.byteLength(input,"utf8") > 16_384', to: "input.length > 16_384" },
  { id: "M16", guard: "Transition reason requirement removed", req: "VIT-LCY-004 / VIT-AC-012", file: "service/triage.mjs",
    from: 'if (typeof command.reason!=="string" || !command.reason.trim() || command.reason.length>1000) throw new TransitionError("A bounded reason is required.");', to: "" },
  { id: "M17", guard: "Review preview renders report text as HTML", req: "VIT-AC-004 / VIT-REP threat model", file: "site/app.mjs",
    from: 'function setPreview(id, value) { document.getElementById("preview-" + id).textContent = value; }',
    to: 'function setPreview(id, value) { document.getElementById("preview-" + id).innerHTML = value; }' },
  { id: "M18", guard: "Private intake gate fails open", req: "VIT-AC-003 gate / VIT-AC-015", file: "site/app.mjs",
    from: "const privateConfigured = publicIntake.enabled === true &&", to: "const privateConfigured = true || publicIntake.enabled === true &&" },
  { id: "M19", guard: "Credential guardrail removed", req: "VIT-AC-008 / VIT-NFR-004", file: "service/report-domain.mjs",
    from: 'refuse("This report appears to contain a credential. Remove it before sending.");', to: "" },
  { id: "M20", guard: "Edit clears typed content", req: "VIT-AC-002 / VIT-UX-003", file: "site/app.mjs",
    from: '  draft=null;\n  requestId=null;\n  resetChallenge();\n  progress.textContent="Step 1 of 2',
    to: '  draft=null;\n  requestId=null;\n  form.reset();\n  resetChallenge();\n  progress.textContent="Step 1 of 2' }
]);

const SUITES = Object.freeze({
  unit: ["npm", ["test", "--silent"]],
  adversarial: ["npm", ["run", "--silent", "test:adversarial"]],
  browser: ["npm", ["run", "--silent", "test:browser", "--", "--project=w375", "--reporter=line"]]
});

/** Pure: apply a single textual mutation, refusing if the anchor is missing or ambiguous. */
export function applyMutation(source, { from, to }) {
  const first = source.indexOf(from);
  if (first < 0) return { ok: false, error: "anchor not found" };
  if (source.indexOf(from, first + 1) >= 0) return { ok: false, error: "anchor ambiguous" };
  return { ok: true, value: source.slice(0, first) + to + source.slice(first + from.length) };
}

/** Pure: summarise a node:test / playwright run output. */
export function summarise(status, output) {
  const num = re => Number((output.match(re) ?? [])[1] ?? NaN);
  return {
    exit: status,
    killed: status !== 0,
    pass: num(/# pass (\d+)/) || num(/(\d+) passed/),
    fail: num(/# fail (\d+)/) || num(/(\d+) failed/) || 0
  };
}

function prepareCopy(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const entry of ["site", "service", "schemas", "tests", "docs", "infra", "conditor.json", "DEPLOYMENT.md", "package.json", "package-lock.json"]) {
    if (existsSync(join(ROOT, entry))) cpSync(join(ROOT, entry), join(dir, entry), { recursive: true, filter: s => !s.includes("/.output") });
  }
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = name => process.argv.find(x => x.startsWith("--" + name + "="))?.slice(name.length + 3);
  const scratch = arg("scratch");
  if (!scratch) { process.stderr.write("--scratch=<dir> is required (never mutate the working tree)\n"); process.exit(2); }
  const suites = (arg("suites") ?? "unit,adversarial").split(",");
  const only = arg("only")?.split(",");
  const results = [];
  for (const mutant of MUTANTS.filter(m => !only || only.includes(m.id))) {
    const dir = join(scratch, "mutant-" + mutant.id);
    prepareCopy(dir);
    const path = join(dir, mutant.file);
    const applied = applyMutation(readFileSync(path, "utf8"), mutant);
    if (!applied.ok) { results.push({ ...mutant, error: applied.error }); continue; }
    writeFileSync(path, applied.value);
    const outcome = Object.fromEntries(suites.map(suite => {
      const [cmd, args] = SUITES[suite];
      const run = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: 600_000, env: { ...process.env, CI: "" } });
      return [suite, summarise(run.status, (run.stdout ?? "") + (run.stderr ?? ""))];
    }));
    const row = { id: mutant.id, guard: mutant.guard, req: mutant.req, file: mutant.file, outcome };
    results.push(row);
    process.stdout.write(JSON.stringify(row) + "\n");
    rmSync(dir, { recursive: true, force: true });
  }
  writeFileSync(join(scratch, "mutation-results.json"), JSON.stringify(results, null, 2));
}
