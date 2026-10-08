// VIT-AC-014 ("failing workflow never counted as a deploy"), VIT-NFR-004 (least privilege, supply chain).
// Text-level structural checks on owned workflows; no YAML dependency is added.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
// praxis-validation.yml is Praxis-generated and fingerprint-verified by Praxis; it must not be
// edited here, so it is the ONLY workflow excluded. Every other workflow (including any added
// later) is covered automatically.
const PRAXIS_GENERATED = Object.freeze(["praxis-validation.yml"]);
const ALL_WORKFLOWS = readdirSync(new URL("../.github/workflows/", import.meta.url)).filter(f => /\.ya?ml$/.test(f)).sort();
const OWNED = Object.freeze(ALL_WORKFLOWS.filter(f => !PRAXIS_GENERATED.includes(f)).map(f => `.github/workflows/${f}`));

// Split a workflow into its top-level job blocks: { name -> text }.
const jobsOf = text => {
  const body = text.split(/^jobs:\s*$/m)[1] || "";
  const parts = body.split(/^  (?=[a-zA-Z0-9_-]+:\s*$)/m).filter(p => p.trim());
  return Object.fromEntries(parts.map(p => [p.split(":")[0].trim(), p]));
};
// Remove full-line YAML comments so documentation text cannot satisfy or trip checks.
const stripComments = text => text.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
const usesLines =text => [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)].map(m => ({ ref: m[1], comment: m[2].trim() }));

test("workflow coverage: every non-Praxis workflow is checked, including governance and browser", () => {
  for (const f of ["pages.yml", "test.yml", "p0-service.yml", "conditor-plan.yml", "conditor-install-preview.yml", "conditor-governance.yml", "browser.yml"]) {
    assert.ok(OWNED.includes(`.github/workflows/${f}`), `${f} must be covered`);
  }
  assert.ok(!OWNED.some(f => f.endsWith("praxis-validation.yml")));
});

test("all third-party actions in owned workflows are pinned to full commit SHAs with a tag comment", () => {
  for (const file of OWNED) {
    const uses = usesLines(stripComments(read(file)));
    assert.ok(uses.length > 0, `${file} has no actions?`);
    for (const { ref, comment } of uses) {
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${file}: ${ref} is not SHA-pinned`);
      assert.match(comment, /^# v\d+/, `${file}: ${ref} lacks a '# vN' tag comment`);
    }
  }
});

test("pages.yml: default no permissions, jobs are chained test -> build -> deploy -> verify-canonical", () => {
  const text = stripComments(read(".github/workflows/pages.yml"));
  assert.match(text, /^permissions: \{\}\s*$/m, "workflow-level permissions must be empty");
  const jobs = jobsOf(text);
  assert.deepEqual(Object.keys(jobs), ["test", "build", "deploy", "verify-canonical"]);
  assert.match(jobs.build, /needs: test\b/);
  assert.match(jobs.deploy, /needs: build\b/);
  assert.match(jobs["verify-canonical"], /needs: deploy\b/);
  assert.match(jobs.test, /run: npm test/);
  assert.match(jobs.test, /secret-scan\.mjs site/);
  assert.match(jobs["verify-canonical"], /verify-public-site\.mjs/);
});

test("pages.yml: write/OIDC permissions exist only on the deploy job; nothing hides failures", () => {
  const text = stripComments(read(".github/workflows/pages.yml"));
  const jobs = jobsOf(text);
  for (const [name, block] of Object.entries(jobs)) {
    const writes = /pages: write|id-token: write/.test(block);
    assert.equal(writes, name === "deploy", `${name}: pages/id-token write must be limited to deploy`);
    assert.doesNotMatch(block, /contents: write/);
  }
  assert.match(jobs.build, /actions\/configure-pages@/);
  assert.match(jobs.build, /actions\/upload-pages-artifact@/);
  assert.doesNotMatch(jobs.deploy, /configure-pages|upload-pages-artifact/, "deploy must not re-run setup");
  assert.doesNotMatch(text, /continue-on-error:\s*true/);
  assert.doesNotMatch(text, /if:\s*(always|failure)\(\)/);
  assert.doesNotMatch(text, /enablement:\s*true/, "enabling Pages is an operator action");
  assert.doesNotMatch(text, /secrets\./, "no secrets in the Pages workflow");
  assert.match(text, /path: \.\/site\s*$/m, "upload only the site/ tree");
});

test("no workflow other than the Pages deploy job requests write scopes", () => {
  for (const file of OWNED) {
    const text = stripComments(read(file));
    const writes = [...text.matchAll(/^\s+([a-z-]+):\s*write\s*$/gm)].map(m => m[1]);
    if (file.endsWith("pages.yml")) {
      assert.deepEqual([...new Set(writes)].sort(), ["id-token", "pages"], file);
    } else if (file.endsWith("nuget-publish.yml")) {
      // Owner-approved NuGet Trusted Publishing (docs/NUGET-PACKAGES.md) needs an OIDC
      // token and nothing else: exactly one id-token grant, no other write scope.
      assert.deepEqual(writes, ["id-token"], file);
    } else {
      assert.deepEqual(writes, [], `${file} must be read-only`);
    }
    assert.match(text, /^permissions:/m, `${file} must declare top-level permissions`);
    assert.doesNotMatch(text, /permissions:\s*write-all|permissions:\s*read-all/, file);
  }
});

test("test.yml also runs adversarial tests and builds/runs the F# domain tests on a pinned .NET 8", () => {
  const jobs = jobsOf(stripComments(read(".github/workflows/test.yml")));
  assert.deepEqual(Object.keys(jobs).sort(), ["domain-fsharp", "test"]);
  assert.match(jobs.test, /run: npm ci/);
  assert.match(jobs.test, /npm run test:adversarial/);
  assert.match(jobs["domain-fsharp"], /actions\/setup-dotnet@[0-9a-f]{40} # v4/);
  assert.match(jobs["domain-fsharp"], /dotnet-version: '8\.0\.x'/);
  assert.match(jobs["domain-fsharp"], /dotnet build domain\/Vitium\.Domain\.Tests/);
  assert.match(jobs["domain-fsharp"], /dotnet run --project domain\/Vitium\.Domain\.Tests/);
});

test("p0-service.yml installs locked deps, runs integration tests and syntax-checks service adapters", () => {
  const text = stripComments(read(".github/workflows/p0-service.yml"));
  const order = ["run: npm ci", "run: npm test", "run: npm run test:integration", "node --check", "sam build"].map(s => text.indexOf(s));
  assert.ok(order.every(i => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "steps must run in this order");
  assert.match(text, /service\/adapters\/\*\.mjs/);
  assert.doesNotMatch(text, /npm install\b/);
});

test("test.yml runs on pull_request and push, read-only, with the repository credential scan", () => {
  const text = stripComments(read(".github/workflows/test.yml"));
  assert.match(text, /^\s{2}pull_request:/m);
  assert.match(text, /^\s{2}push:/m);
  assert.match(text, /^permissions:\s*\n\s+contents: read\s*$/m);
  assert.doesNotMatch(text, /: write/);
  assert.match(text, /run: npm test/);
  assert.match(text, /secret-scan\.mjs \./);
});

test("owned workflows never persist checkout credentials and never deploy to AWS", () => {
  for (const file of OWNED) {
    const text = stripComments(read(file));
    const checkouts = (text.match(/actions\/checkout@/g) || []).length;
    const persisted = (text.match(/persist-credentials: false/g) || []).length;
    assert.equal(persisted, checkouts, `${file}: every checkout needs persist-credentials: false`);
    assert.doesNotMatch(text, /sam deploy|aws-actions\/configure-aws-credentials/, `${file}: no AWS deploy in CI`);
  }
});

// VIT-AC-035 item 8 / VIT-INT-015 (echo suppression): Vitium's own CI must not report defects
// to Vitium (or open GitHub issues) today. Adding self-reporting must be a deliberate change
// that edits this guard together with a recorded decision (OPERATOR-DECISIONS M-07).
// Reads EVERY workflow, including the Praxis-generated one (read-only, never edited).
const SELF_REPORTING_PATTERNS = Object.freeze([
  { id: "intake-host", re: /intake\.vitium\.echelonfoundry\.com/i },
  { id: "public-report-route", re: /\/api\/v1\/reports\b/ },
  { id: "machine-observation-route", re: /\/api\/v1\/observations\b/ },
  { id: "api-gateway-url", re: /execute-api\.[a-z0-9-]+\.amazonaws\.com/i },
  { id: "intake-or-reporting-secret", re: /secrets\.[A-Z0-9_]*(VITIUM|INTAKE|TURNSTILE|OBSERVATION|REPORT)[A-Z0-9_]*/i },
  { id: "vitium-oidc-audience", re: /audience[^\n]*vitium/i },
  { id: "http-post", re: /\bcurl\b[^\n]*(-X\s*POST|--request\s+POST|--data\b|\s-d\s|--json\b)|\bwget\b[^\n]*--post/i },
  { id: "github-issue-creation", re: /\bgh\s+issue\s+(create|reopen|comment|edit)\b|issues:\s*write|actions\/github-script@/i }
]);

// findSelfReporting :: (file, text) -> [{ file, id, line }]  (pure; comments stripped first)
export const findSelfReporting = (file, text) =>
  stripComments(text).split("\n").flatMap((line, i) =>
    SELF_REPORTING_PATTERNS.filter(p => p.re.test(line)).map(p => ({ file, id: p.id, line: i + 1 })));

test("recursion guard: no Vitium workflow reports to Vitium intake/observations or opens issues", () => {
  assert.ok(ALL_WORKFLOWS.length >= 8, "guard must see every workflow");
  const hits = ALL_WORKFLOWS.flatMap(f => findSelfReporting(f, read(`.github/workflows/${f}`)));
  assert.deepEqual(hits, [], JSON.stringify(hits));
});

test("recursion guard detects each self-reporting shape (no vacuous pass)", () => {
  const samples = {
    "intake-host": "run: node x.mjs https://intake.vitium.echelonfoundry.com/",
    "public-report-route": "url: https://example.invalid/api/v1/reports",
    "machine-observation-route": "run: node report.mjs --endpoint /api/v1/observations",
    "api-gateway-url": "url: https://abc123.execute-api.us-east-1.amazonaws.com/staging",
    "intake-or-reporting-secret": "token: ${{ secrets.VITIUM_MACHINE_TOKEN }}",
    "vitium-oidc-audience": "audience: vitium-intake",
    "http-post": "run: curl -sS -X POST https://example.invalid/hook",
    "github-issue-creation": "run: gh issue create --title failure"
  };
  for (const [id, line] of Object.entries(samples)) {
    assert.ok(findSelfReporting("x.yml", line).some(h => h.id === id), `${id} not detected`);
  }
  assert.deepEqual(findSelfReporting("x.yml", "# curl -X POST https://intake.vitium.echelonfoundry.com/api/v1/reports"), [], "comments are ignored");
  assert.deepEqual(findSelfReporting("x.yml", "run: npm test\nrun: ./praxis validate"), []);
});
