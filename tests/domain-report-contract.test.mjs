// Report text contract (VIT-API-002, VIT-DOM-003; DOM-001 section 12; VF-006/007/008, D-06).
// One set of rules (schemas/report-text-rules.v1.json) is enforced by the JS runtime, the
// intake-request JSON Schema and the F# core; one set of cases (schemas/report-cases.v1.json)
// is replayed by this test and by domain/Vitium.Domain.Tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as rd from "../service/report-domain.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");
const json = path => JSON.parse(readFileSync(new URL("../schemas/" + path, import.meta.url), "utf8"));
const rules = json("report-text-rules.v1.json");
const requestSchema = json("intake-request.schema.json");
const cases = json("report-cases.v1.json").cases;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schemaAccepts = ajv.compile(requestSchema);
const runtime = input => { try { return { ok: true, value: rd.normalizeReport(input) }; } catch (e) { return { ok: false, error: e }; } };

test("rules file, runtime constants and request schema carry identical patterns", () => {
  assert.equal(rules.whitespaceClass, rd.WHITESPACE_CLASS);
  assert.equal(rules.unsafeClass, rd.UNSAFE_CLASS);
  assert.equal(rules.credentialPattern, rd.CREDENTIAL_PATTERN);
  assert.deepEqual(rules.patterns, { ...rd.TEXT_PATTERNS });
  assert.deepEqual(rules.impactCodes, { ...rd.impactCodes });
  for (const f of ["title", "actual", "expected"]) assert.equal(requestSchema.properties[f].pattern, rd.TEXT_PATTERNS.required, f);
  assert.equal(requestSchema.properties.steps.pattern, rd.TEXT_PATTERNS.optional);
  assert.equal(requestSchema.properties.pageUrl.pattern, rd.TEXT_PATTERNS.pageUrl);
  for (const [f, max] of Object.entries(rules.limits)) assert.equal(requestSchema.properties[f].maxLength, max, f);
});

test("shared report cases: runtime result and schema verdict match the recorded expectation", () => {
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    const r = runtime(c.input);
    assert.equal(r.ok, c.expect.ok, c.name);
    if (c.expect.ok) assert.deepEqual({ ...r.value }, c.expect.value, c.name);
    const wire = { ...c.input, challengeToken: "challenge-token-123" };
    // schemaExpect: a documented gap the schema language cannot express (only VF-011, DOM-001 s.23).
    assert.equal(schemaAccepts(wire), c.schemaExpect ?? c.expect.ok, c.name + " (schema): " + JSON.stringify(schemaAccepts.errors));
    if (c.schemaExpect !== undefined) assert.ok(c.schemaGap && c.name.startsWith("VF-011"), "every schema gap is documented and limited to VF-011");
  }
});

test("lengths are code points: 120 astral characters accepted, 121 refused (VF-006)", () => {
  const base = cases[0].input;
  assert.equal(runtime({ ...base, title: "\u{1F41E}".repeat(120) }).ok, true);
  assert.equal(runtime({ ...base, title: "\u{1F41E}".repeat(121) }).ok, false);
});

test("canonically equivalent input normalises to identical output (VF-008 domain side)", () => {
  const base = cases[0].input;
  const nfd = runtime({ ...base, title: "Café crash" }).value;
  const nfc = runtime({ ...base, title: "Café crash" }).value;
  assert.deepEqual(nfd, nfc);
  assert.equal(nfd.title, "Café crash");
});

test("visually empty, bidi-spoofing and lone-surrogate text is refused (VF-008)", () => {
  const base = cases[0].input;
  for (const title of ["​", "‍", "⁠", "﻿", "a‮b", "⁦x⁩", "a‏b", "\u009b1m", "a\udc00"]) {
    assert.equal(runtime({ ...base, title }).ok, false, JSON.stringify(title));
  }
  // Format characters inside otherwise visible text are allowed (e.g. ZWJ emoji sequences).
  assert.equal(runtime({ ...base, title: "Family \u{1F468}‍\u{1F469} icon broken" }).ok, true);
});

test("D-06: hyphenated words are not keys; a real-looking key still is", () => {
  const base = cases[0].input;
  assert.equal(runtime({ ...base, title: "The task-management-dashboard-widget is blank" }).ok, true);
  assert.equal(runtime({ ...base, title: "desk-reservation-calendar-overflow bug" }).ok, true);
  assert.equal(runtime({ ...base, actual: ["s", "k-", "x".repeat(20)].join("") }).ok, false);
  assert.equal(runtime({ ...base, actual: ["(", "s", "k-", "x".repeat(20), ")"].join("") }).ok, false);
});

test("credential refusal never echoes the secret", () => {
  const secret = ["gh", "p_", "z".repeat(24)].join("");
  const r = runtime({ ...cases[0].input, steps: secret });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error.message, /gh[p]_/);
});
