// H-04 / H-01: the public Lambda artifact contains exactly the intake import closure (no
// operator tooling), and staging origin parameterisation never widens production.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, mkdtempSync, readdirSync, rmSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname, normalize} from "node:path";
import {execFileSync} from "node:child_process";
import {readConfig, originAllowed} from "../service/aws-handler.mjs";

const serviceDir = new URL("../service/", import.meta.url);
const read = rel => readFileSync(new URL(rel, serviceDir), "utf8");

/** Pure-ish: static relative import closure starting at a module (service-relative paths). */
function closure(entry) {
  const seen = new Set();
  const visit = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel);
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^"'\n]*?from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      visit(normalize(join(dirname(rel), m[1])));
    }
  };
  visit(entry);
  return [...seen].sort();
}
const makefileList = () => {
  const mk = read("Makefile");
  const grab = name => mk.match(new RegExp("^" + name + " = (.+)$", "m"))[1].trim().split(/\s+/);
  return [...grab("PUBLIC_MODULES"), ...grab("PUBLIC_ADAPTERS")].filter(f => f.endsWith(".mjs")).sort();
};

test("P-01 H-04: Makefile allowlist equals the handler's import closure and excludes operator tooling", () => {
  const graph = closure("aws-handler.mjs");
  assert.deepEqual(makefileList(), graph);
  for (const forbidden of ["triage-cli.mjs", "triage.mjs", "lifecycle.mjs", "domain-records.mjs", "product-registry.mjs"]) {
    assert.ok(!graph.includes(forbidden), forbidden + " reachable from the public handler");
  }
  const template = readFileSync(new URL("../infra/aws/template.yaml", import.meta.url), "utf8");
  assert.match(template, /BuildMethod: makefile/);
});

test("P-02 H-04: `make build-IntakeFunction` produces an artifact whose handler loads and refuses without config", async (t) => {
  let make;
  try { make = execFileSync("which", ["make"]).toString().trim(); } catch { make = ""; }
  if (!make) { t.skip("make not installed"); return; }
  const out = mkdtempSync(join(tmpdir(), "vitium-lambda-"));
  try {
    execFileSync(make, ["-s", "-C", new URL(".", serviceDir).pathname, "build-IntakeFunction", "ARTIFACTS_DIR=" + out]);
    const files = [...readdirSync(out), ...readdirSync(join(out, "adapters")).map(f => "adapters/" + f)].sort();
    assert.ok(!files.some(f => /triage|lifecycle|domain-records|product-registry/.test(f)), files.join(","));
    assert.ok(existsSync(join(out, "package.json")), "module type must ship");
    const mod = await import(join(out, "aws-handler.mjs"));
    const reply = await mod.handler({rawPath:"/api/v1/reports"});
    assert.equal(reply.statusCode, 503);
  } finally { rmSync(out, {recursive:true, force:true}); }
});

test("P-03 H-01: production accepts only the canonical origin; staging only an exact https subdomain", () => {
  const base = {REPORTS_TABLE_NAME:"t", TURNSTILE_SECRET_ARN:"arn:aws:secretsmanager:us-east-1:000000000000:secret:x"};
  const cfg = (env, origin, host) => readConfig({...base, ENVIRONMENT_NAME:env, ALLOWED_ORIGIN:origin, CHALLENGE_HOSTNAME:host}).ok;
  assert.equal(cfg("production", "https://vitium.echelonfoundry.com", "vitium.echelonfoundry.com"), true);
  assert.equal(cfg(undefined, "https://vitium.echelonfoundry.com", "vitium.echelonfoundry.com"), true);
  assert.equal(cfg("staging", "https://staging.vitium.echelonfoundry.com", "staging.vitium.echelonfoundry.com"), true);
  for (const [env, origin, host] of [
    ["production", "https://staging.vitium.echelonfoundry.com", "staging.vitium.echelonfoundry.com"],
    [undefined, "https://staging.vitium.echelonfoundry.com", "staging.vitium.echelonfoundry.com"],
    ["staging", "https://staging.vitium.echelonfoundry.com", "other.vitium.echelonfoundry.com"],
    ["staging", "http://staging.vitium.echelonfoundry.com", "staging.vitium.echelonfoundry.com"],
    ["staging", "https://a.b.vitium.echelonfoundry.com", "a.b.vitium.echelonfoundry.com"],
    ["staging", "https://evilvitium.echelonfoundry.com", "evilvitium.echelonfoundry.com"],
    ["staging", "https://staging.vitium.echelonfoundry.com.evil.example", "staging.vitium.echelonfoundry.com.evil.example"],
    ["staging", "*", "*"]
  ]) assert.equal(cfg(env, origin, host), false, [env, origin, host].join(" "));
  assert.equal(originAllowed({environment:"staging", origin:"https://vitium.echelonfoundry.com", host:"vitium.echelonfoundry.com"}), true);
});
