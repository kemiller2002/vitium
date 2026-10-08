// Schema contracts (VIT-DOM-003, VIT-API-002 domain side). Uses a deliberately small,
// strict JSON Schema 2020-12 subset validator so no dependency is added. Any keyword the
// validator does not implement makes the test FAIL, so schemas cannot silently rely on
// unchecked keywords.
import test from "node:test";
import assert from "node:assert/strict";
import { products, impacts, normalizeReport } from "../service/report-domain.mjs";
import { SUPPORTED, validate, validateFile, readSchema as read } from "./domain-json-schema.mjs";

test("validator itself rejects plausible violations (guards against a vacuous validator)", () => {
  const s = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string", pattern: "^x" } } };
  assert.deepEqual(validate(s, { a: "xy" }, { file: "t" }), []);
  assert.ok(validate(s, { a: "y" }, { file: "t" }).length);
  assert.ok(validate(s, {}, { file: "t" }).length);
  assert.ok(validate(s, { a: "x", b: 1 }, { file: "t" }).length);
  assert.ok(validate({ oneOf: [] }, 1, { file: "t" }).some(e => /unsupported keyword oneOf/.test(e)));
});

test("lifecycle table and product registry conform to their JSON Schemas", () => {
  assert.deepEqual(validateFile("lifecycle/transitions.schema.v1.json", read("lifecycle/transitions.v1.json")), []);
  assert.deepEqual(validateFile("products.schema.v1.json", read("products.v1.json")), []);
  const t = read("lifecycle/transitions.v1.json");
  t.ordoAuthorized = true;
  assert.ok(validateFile("lifecycle/transitions.schema.v1.json", t).length, "schema refuses a claim of Ordo authority");
  const p = read("products.v1.json");
  p.products[0].alias = ["typo"];
  assert.ok(validateFile("products.schema.v1.json", p).length, "schema refuses unexpected properties");
});

test("all v2 schemas are versioned and closed (additionalProperties:false on every object)", () => {
  for (const file of ["observation.v2.schema.json", "defect.v2.schema.json", "intake-request.schema.json", "observation.schema.json", "defect.schema.json"]) {
    const schema = read(file);
    assert.equal(schema.additionalProperties, false, file);
    assert.ok(schema.required.includes("schemaVersion") || file === "observation.schema.json", file + " requires schemaVersion");
    // Visit every subschema: check closure and that only validator-supported keywords appear.
    const visit = (node, path) => {
      for (const k of Object.keys(node)) assert.ok(SUPPORTED.has(k), file + " " + path + " uses unsupported keyword " + k);
      if (node.properties) assert.equal(node.additionalProperties, false, file + " " + path + " must be closed");
      for (const [k, v] of Object.entries({ ...node.properties, ...node.$defs })) visit(v, path + "/" + k);
      if (node.items) visit(node.items, path + "/items");
    };
    visit(schema, "#");
  }
});

test("intake-request schema matches runtime validation (product, impact, bounds, closed object)", () => {
  const schema = read("intake-request.schema.json");
  assert.deepEqual(schema.properties.product.enum, [...products]);
  assert.deepEqual(schema.properties.impact.enum, [...impacts]);
  const valid = { schemaVersion: "1.0", product: "Forma", impact: "Not sure", title: "t", actual: "a", expected: "e", privacyAcknowledged: true, challengeToken: "challenge-token-123" };
  assert.deepEqual(validateFile("intake-request.schema.json", valid), []);
  assert.ok(normalizeReport(valid));
  for (const [field, limit] of [["title", 120], ["actual", 1200], ["expected", 1200], ["steps", 900]]) {
    assert.equal(schema.properties[field].maxLength, limit, field);
    const over = { ...valid, [field]: "x".repeat(limit + 1) };
    assert.ok(validateFile("intake-request.schema.json", over).length, field + " schema refuses overlong");
    assert.throws(() => normalizeReport(over), /too long/, field + " runtime refuses overlong");
  }
  const extra = { ...valid, severity: "critical" };
  assert.ok(validateFile("intake-request.schema.json", extra).length);
  assert.throws(() => normalizeReport(extra), /Unexpected report field/);
  const v2 = { ...valid, schemaVersion: "2.0" };
  assert.ok(validateFile("intake-request.schema.json", v2).length);
  assert.throws(() => normalizeReport(v2), /Unsupported report version/);
  const alias = { ...valid, product: "SDE" };
  assert.ok(validateFile("intake-request.schema.json", alias).length, "transport v1 accepts display names only");
  assert.throws(() => normalizeReport(alias), /supported application/);
});
