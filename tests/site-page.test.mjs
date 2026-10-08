// Static page, projection and client-asset checks (VIT-UX-003/006, VIT-NFR-003, VIT-AC-015).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { initialState, transition, reduce } from "../site/state.mjs";
import { project, COPY, FIELD_IDS, FOCUS_TARGETS } from "../site/view.mjs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("site/index.html");
const outsideTemplates = page.replace(/<template[\s\S]*?<\/template>/g, "");
const ids = html => [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const testids = html => [...html.matchAll(/\sdata-testid="([^"]+)"/g)].map(m => m[1]);

test("canonical metadata points only at the custom domain (VIT-NFR-003)", () => {
  assert.match(page, /<link rel="canonical" href="https:\/\/vitium\.echelonfoundry\.com\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/vitium\.echelonfoundry\.com\/">/);
  for (const file of readdirSync(new URL("../site/", import.meta.url))) {
    assert.doesNotMatch(read("site/" + file), /github\.io/i, file);
  }
});

test("ids and test ids are unique across the page and its templates", () => {
  for (const list of [ids(page), testids(page)]) {
    assert.equal(new Set(list).size, list.length, "duplicates: " + list.filter((x, i) => list.indexOf(x) !== i));
  }
});

test("every form control has a stable id, a programmatic label and a test id (VIT-UX-006)", () => {
  const controls = [...page.matchAll(/<(input|select|textarea|button)\b([^>]*)>/g)];
  assert.ok(controls.length >= 12);
  for (const [, tag, attrs] of controls) {
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    assert.ok(id, tag + " without id: " + attrs);
    assert.match(attrs, /data-testid="/, id + " test id");
    if (tag !== "button") assert.match(page, new RegExp('<label for="' + id + '"'), id + " label");
  }
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    assert.match(page, new RegExp('id="' + id + '-error"'), field + " error slot");
  }
  assert.doesNotMatch(page, /<div[^>]*role="button"|onclick=/i, "native controls only");
});

test("status region, error summary and focus targets exist", () => {
  assert.match(page, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(page, /id="feedback"[^>]*role="alert"[^>]*tabindex="-1"/);
  for (const [name, id] of Object.entries(FOCUS_TARGETS)) {
    assert.match(page, new RegExp('id="' + id + '"'), "focus target " + name);
  }
  for (const id of ["form-title", "review-title", "success-title", "review-status", "submit-error"]) {
    assert.match(page, new RegExp('id="' + id + '"[^>]*tabindex="-1"'), id + " must be programmatically focusable");
  }
});

test("private intake UI is inert while disabled: only inside <template>, never in the live document", () => {
  for (const id of ["private-destination", "turnstile-challenge", "submit-private", "private-success", "report-reference", "private-foot", "submit-error"]) {
    assert.doesNotMatch(outsideTemplates, new RegExp('id="' + id + '"'), id + " outside template");
    assert.match(page, new RegExp('id="' + id + '"'), id + " present in template");
  }
  assert.doesNotMatch(outsideTemplates, /Send private report|stored privately|does not require a GitHub account/i);
  assert.match(outsideTemplates, /GitHub account is currently required to submit/);
  assert.match(outsideTemplates, /You must sign in to GitHub and select <strong>Submit new issue<\/strong> there to finish/);
});

test("client assets contain no secrets or token-bearing URLs (VIT-AC-015)", () => {
  for (const file of readdirSync(new URL("../site/", import.meta.url))) {
    const text = read("site/" + file);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, file);
    assert.doesNotMatch(text, /\bgh[pousr]_[A-Za-z0-9_]{15,}/, file);
    assert.doesNotMatch(text, /\bAKIA[0-9A-Z]{16}\b/, file);
    assert.doesNotMatch(text, /\bsk-[A-Za-z0-9_-]{18,}/, file);
    assert.doesNotMatch(text, /(secret|siteverify)\s*[:=]\s*["'][^"']{8,}/i, file);
    assert.doesNotMatch(text, /https?:\/\/[^"'\s]*[?&](token|key|secret|password)=/i, file);
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie/, file + " must not persist drafts");
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file + " must not inject HTML");
  }
});

test("site modules have no service/ or node: runtime imports", () => {
  for (const file of readdirSync(new URL("../site/", import.meta.url)).filter(f => f.endsWith(".mjs"))) {
    const text = read("site/" + file);
    assert.doesNotMatch(text, /from\s+["'](\.\.\/service|node:)/, file);
  }
});

test("state and view modules are pure: no DOM/network/timer globals in state or projection", () => {
  const state = read("site/state.mjs");
  assert.doesNotMatch(state, /\b(document|window|fetch|setTimeout|crypto|Date\.now|Math\.random|navigator)\b/);
  const intake = read("site/private-intake.mjs").replace(/export function makeHttpPerformer[\s\S]*$/, "");
  assert.doesNotMatch(intake, /\b(document|window|fetch\(|setTimeout|crypto|Math\.random)\b/);
});

test("review projection shows exactly what will be sent plus visibility and retention notices (VIT-UX-003)", () => {
  const values = { product: "Forma", impact: "Not sure", title: " T ", actual: "A\nB", expected: "E", steps: "", pageUrl: "https://x.example/p?q=1", privacyAcknowledged: true };
  const legacy = project(reduce(initialState(), { type: "ReviewRequested", values }));
  assert.equal(legacy.reviewVisible, true);
  assert.equal(legacy.formVisible, false);
  assert.deepEqual(legacy.preview, { product: "Forma", impact: "Not sure", title: "T", actual: "A\nB", expected: "E", steps: "", pageUrl: "https://x.example/p" });
  assert.equal(legacy.githubDestinationVisible, true);
  assert.equal(legacy.privateDestinationVisible, false);
  assert.equal(legacy.submitVisible, false);
  assert.equal(legacy.resultVisible, false);
  for (const copy of [COPY.github, COPY.private]) {
    assert.match(copy.retention, /not yet|not been decided/i);
    assert.doesNotMatch(copy.retention, /\b\d+\s*(day|week|month|year)s?\b/i, "no invented retention period");
  }
  const priv = project(reduce(initialState("private"), { type: "ReviewRequested", values, requestId: randomUUID() }));
  assert.equal(priv.privateDestinationVisible, true);
  assert.equal(priv.githubDestinationVisible, false);
  assert.equal(priv.submitVisible, true);
  assert.match(priv.reviewStatus, /has not been sent/);
});

test("success is never projected without a receipt; errors are text, not colour alone", () => {
  const key = randomUUID();
  let s = reduce(initialState("private"), { type: "ReviewRequested", values: { product: "Forma", impact: "Not sure", title: "T", actual: "A", expected: "E", privacyAcknowledged: true }, requestId: key });
  s = reduce(s, { type: "ChallengeSolved", token: "token-0123456789ab" });
  s = reduce(s, { type: "SubmitRequested" });
  assert.equal(project(s).busy, true);
  assert.equal(project(s).submitDisabled, true);
  assert.equal(project(s).resultVisible, false);
  const failed = project(reduce(s, { type: "SubmitCompleted", correlationId: key, outcome: { kind: "Success", status: 201, body: { status: "received" } } }));
  assert.equal(failed.resultVisible, false);
  assert.equal(failed.result, null);
  assert.ok(failed.submitError.message.length > 10);
  assert.equal(failed.submitLabel, "Try sending again");
  const invalid = project(reduce(initialState(), { type: "ReviewRequested", values: {} }));
  assert.ok(invalid.errors.length >= 5);
  for (const e of invalid.errors) assert.ok(e.message && e.controlId, JSON.stringify(e));
  assert.match(read("site/styles.css"), /\.field-error::before\s*\{\s*content:/, "error marker is not colour-only");
});

test("styles support 320px, focus visibility and reduced motion without forking Forma", () => {
  const css = read("site/styles.css");
  assert.match(css, /:focus-visible\s*\{[^}]*outline/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /(^|[^-])\bwidth:\s*(3[2-9]\d|[4-9]\d\d|\d{4,})px/m, "no fixed widths wider than 320px");
  assert.doesNotMatch(css, /--ef-|\.ef-/, "Vitium styles must not redefine Forma tokens or classes");
  assert.match(page, /@echelon-foundry\/design-system@\d+\.\d+\.\d+\/dist\/all\.css/, "Forma pinned to an exact version");
});

test("legacy GitHub path never claims submission anywhere in its copy", () => {
  const states = [initialState(), reduce(initialState(), { type: "ReviewRequested", values: { product: "Forma", impact: "Not sure", title: "T", actual: "A", expected: "E", privacyAcknowledged: true } })];
  states.push(reduce(states[1], { type: "HandoffOpened" }));
  for (const s of states) {
    const v = project(s);
    assert.doesNotMatch(v.progress + v.announcement, /(?<!not (been )?)submitted\b(?! until)|received|\bsent\b/i, v.phase + ": " + v.announcement);
  }
  const stepped = transition(states[1], { type: "HandoffOpened" });
  assert.deepEqual(stepped.effects, []);
});
