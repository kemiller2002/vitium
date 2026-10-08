// Machine-observation envelope v1 (VIT-INT-013, VIT-INT-017): the JSON Schema and the
// runtime validator (service/machine/contract.mjs) carry the same rules and give the same
// verdict on every shared case (schemas/machine/cases/envelope-cases.v1.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { PATTERNS, ENUMS, BOUNDS, SCHEMA_VERSION, validateEnvelope, isInstant } from "../service/machine/contract.mjs";
import { checkEnvelope } from "../service/machine/observation-core.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js");
const json = path => JSON.parse(readFileSync(new URL("../schemas/machine/" + path, import.meta.url), "utf8"));
const schema = json("observation-envelope.v1.schema.json");
const cases = json("cases/envelope-cases.v1.json").cases;
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true, strictRequired: false });
const schemaAccepts = ajv.compile(schema);

const setPath = (obj, dotted, value) => {
  const keys = dotted.split(".");
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], obj);
  parent[last] = value;
};
const unsetPath = (obj, dotted) => {
  const keys = dotted.split(".");
  const last = keys.pop();
  delete keys.reduce((o, k) => o[k], obj)[last];
};
const hex64 = i => i.toString(16).padStart(64, "0");
export function buildCase(c) {
  const value = json("examples/" + c.base);
  for (const [path, v] of Object.entries(c.set || {})) setPath(value, path, v);
  for (const [path, parts] of Object.entries(c.setJoined || {})) setPath(value, path, parts.join(""));
  for (const path of c.unset || []) unsetPath(value, path);
  if (c.repeat) setPath(value, c.repeat.path, c.repeat.char.repeat(c.repeat.count));
  if (c.evidenceCount) value.evidence = Array.from({ length: c.evidenceCount }, (_, i) => ({ ...value.evidence[0], sha256: hex64(i + 1) }));
  if (c.duplicateEvidence) value.evidence = [value.evidence[0], { ...value.evidence[0] }];
  return value;
}

test("schema is closed, versioned and every string/array is bounded", () => {
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION);
  const walk = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") assert.equal(node.additionalProperties, false, at + " must be closed");
    if (node.type === "string") {
      assert.ok(Number.isInteger(node.maxLength), at + " string needs maxLength");
      assert.ok(typeof node.pattern === "string", at + " string needs a pattern");
    }
    if (node.type === "array") assert.ok(Number.isInteger(node.maxItems), at + " array needs maxItems");
    for (const [k, v] of Object.entries(node)) if (typeof v === "object") walk(v, at + "/" + k);
  };
  walk(schema, "#");
});

test("schema carries exactly the runtime contract's patterns, enums and bounds", () => {
  const p = schema.properties;
  assert.equal(schema.$defs.eventId.pattern, PATTERNS.eventId);
  assert.equal(schema.$defs.identifier.pattern, PATTERNS.identifier);
  assert.equal(schema.$defs.identifier.maxLength, BOUNDS.identifierMax);
  assert.deepEqual(p.eventType.enum, ENUMS.eventType);
  assert.deepEqual(p.source.properties.system.enum, ENUMS.system);
  assert.equal(p.source.properties.repository.pattern, PATTERNS.repository);
  assert.equal(p.source.properties.repository.maxLength, BOUNDS.repositoryMax);
  assert.equal(p.subject.properties.commit.pattern, PATTERNS.commit);
  assert.deepEqual(p.subject.properties.environment.enum, ENUMS.environment);
  assert.equal(p.subject.properties.runAttempt.maximum, BOUNDS.runAttemptMax);
  assert.deepEqual(p.finding.properties.category.enum, ENUMS.category);
  assert.deepEqual(p.finding.properties.classification.enum, ["untriaged"]);
  assert.deepEqual(ENUMS.classification, ["untriaged"]);
  assert.deepEqual(p.finding.properties.confidence.enum, ENUMS.confidence);
  for (const f of ["summary", "expected", "observed"]) assert.equal(p.finding.properties[f].pattern, PATTERNS.text, f);
  assert.equal(p.finding.properties.summary.maxLength, BOUNDS.summaryMax);
  assert.equal(p.finding.properties.observed.maxLength, BOUNDS.detailMax);
  assert.equal(p.evidence.maxItems, BOUNDS.evidenceMax);
  assert.equal(p.evidence.minItems, BOUNDS.evidenceMin);
  assert.deepEqual(p.evidence.items.properties.kind.enum, ENUMS.evidenceKind);
  assert.equal(p.evidence.items.properties.uri.pattern, PATTERNS.evidenceUri);
  assert.equal(p.evidence.items.properties.sha256.pattern, PATTERNS.sha256);
  assert.equal(p.correlation.properties.defectId.anyOf[1].pattern, PATTERNS.defectId);
  assert.equal(p.correlation.properties.originMarker.anyOf[1].pattern, PATTERNS.originMarker);
  assert.equal(p.observedAt.pattern, PATTERNS.instant);
  // VIT-INT-017: five distinct kinds, none of which names a lifecycle state.
  assert.equal(new Set(ENUMS.eventType).size, 5);
  for (const forbidden of ["resolved", "closed", "confirmed", "in-progress"]) assert.ok(!ENUMS.eventType.some(t => t.includes(forbidden)));
});

test("every example fixture is valid under both the schema and the runtime", () => {
  const files = readdirSync(new URL("../schemas/machine/examples/", import.meta.url)).filter(f => f.endsWith(".json"));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const value = json("examples/" + f);
    assert.ok(schemaAccepts(value), f + " " + JSON.stringify(schemaAccepts.errors));
    assert.equal(validateEnvelope(value).ok, true, f);
    // eventIds in examples are unique so tests cannot accidentally share idempotency keys
  }
  const ids = files.map(f => json("examples/" + f).eventId);
  assert.equal(new Set(ids).size, ids.length);
});

test("shared cases: schema (ajv) and runtime verdicts match the recorded expectation", () => {
  assert.ok(cases.length >= 60, "case corpus shrank");
  assert.ok(cases.filter(c => !c.expect.ok).length >= 50);
  for (const c of cases) {
    const value = buildCase(c);
    const runtime = validateEnvelope(value);
    assert.equal(runtime.ok, c.expect.ok, "runtime: " + c.name + " " + JSON.stringify(runtime.error));
    if (!c.expect.ok) assert.equal(runtime.error.path, c.expect.path, "runtime path: " + c.name);
    const schemaVerdict = schemaAccepts(value);
    if (c.runtimeOnly) assert.equal(schemaVerdict, true, "documented runtime-only check: " + c.name);
    else assert.equal(schemaVerdict, c.expect.ok, "schema: " + c.name + " " + JSON.stringify(schemaAccepts.errors));
    if (c.expect.code) {
      const core = checkEnvelope(value);
      assert.equal(core.ok, false, c.name);
      assert.equal(core.error.code, c.expect.code, "core code: " + c.name);
    }
  }
});

test("runtime-only divergence is limited to calendar ranges", () => {
  for (const c of cases.filter(x => x.runtimeOnly)) assert.equal(c.expect.path, "$.observedAt", c.name);
  assert.equal(isInstant("2024-02-29T00:00:00Z"), true);
  assert.equal(isInstant("2026-02-29T00:00:00Z"), false);
});

test("validated envelope is a frozen deep copy: caller mutation cannot change it", () => {
  const raw = json("examples/observation-detected.ci.v1.json");
  const v = validateEnvelope(raw);
  assert.ok(v.ok);
  raw.source.repository = "attacker/other";
  assert.equal(v.value.source.repository, "kemiller2002/summa");
  assert.ok(Object.isFrozen(v.value.source));
  assert.throws(() => { "use strict"; v.value.finding.classification = "confirmed"; }, TypeError);
});

test("validator is total: non-objects and hostile shapes return typed refusals", () => {
  for (const bad of [null, undefined, 42, "x", [], { __proto__: { schemaVersion: "1.0" } }]) {
    const r = validateEnvelope(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error.code, "string");
  }
});
