import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const manifest = JSON.parse(read("conditor.json"));
const html = read("site/index.html");
const deployment = read("DEPLOYMENT.md");

test("canonical public origin is exact in SEO metadata and deployment contract", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/vitium\.echelonfoundry\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/vitium\.echelonfoundry\.com\/">/);
  assert.match(deployment, /https:\/\/vitium\.echelonfoundry\.com\//);
  assert.doesNotMatch(html, /https:\/\/kemiller2002\.github\.io\/vitium\/?/);
});

test("Conditor manifest declares exactly qualified initial lifecycle versions", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, "vitium");
  const components = Object.fromEntries(manifest.components.map(x => [x.id, x.version]));
  assert.deepEqual(components, {
    praxis: "3.7.2",
    ordo: "1.5.0",
    "visual-engineering": "1.0.1",
    "communication-engineering": "1.0.0"
  });
  assert.equal(manifest.components.length, Object.keys(components).length);
  assert.ok(manifest.components.every(x => x.required === true));
  assert.equal(manifest.execution.enabled, false);
  assert.equal(manifest.scaffold, undefined, "Do not claim an installed scaffold while migration is outstanding");
});

test("report form retains explicit public-data and GitHub handoff disclosures", () => {
  assert.match(html, /GitHub Issues in this repository are public/);
  assert.match(html, /A GitHub account is currently required to submit/);
  assert.match(html, /You must sign in to GitHub and select/);
  assert.match(html, /id="privacyAcknowledged" required/);
  assert.match(html, /id="review"/);
  assert.match(html, /data-testid="github-submit"/);
});

test("reporting remains accessible to keyboard-driven and machine-driven clients", () => {
  for (const id of ["product","impact","title","actual","expected","steps","pageUrl"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(html, new RegExp('for="' + id + '"'));
  }
  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="feedback" role="alert"/);
  assert.match(html, /id="edit"/);
  assert.match(read("site/styles.css"), /:focus-visible/);
});

test("deployment instructions do not confuse GitHub Actions and branch-hosted CNAME files", () => {
  assert.match(deployment, /GitHub Actions workflow/);
  assert.match(deployment, /CNAME/);
  assert.match(deployment, /kemiller2002\.github\.io/);
  assert.match(deployment, /CNAME file.*ignored/);
});
