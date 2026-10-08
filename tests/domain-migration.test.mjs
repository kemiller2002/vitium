// Explicit v1 -> v2 migration (VIT-DOM-003/005/006, VIT-AC-010).
// observation.v1.bba1d59.json was produced by running the baseline service/intake.mjs and
// baseline service/triage.mjs (commit bba1d59) — it is the real persisted v1 shape.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRegistry } from "../service/product-registry.mjs";
import { migrate, migrateObservationV1, migrateDefectV1 } from "../service/domain-records.mjs";
import { validateFile } from "./domain-json-schema.mjs";

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const registry = loadRegistry(json("../schemas/products.v1.json")).value;
const obsV1 = json("./fixtures/observation.v1.bba1d59.json");
const defV1 = json("./fixtures/defect.v1.example.json");

test("fixtures are valid against the v1 schemas they claim to be", () => {
  assert.deepEqual(validateFile("observation.schema.json", obsV1), []);
  assert.deepEqual(validateFile("defect.schema.json", defV1), []);
});

test("v1 observation migrates to a valid v2 record without losing meaning", () => {
  const r = migrateObservationV1(registry, obsV1);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const v2 = r.value;
  assert.deepEqual(validateFile("observation.v2.schema.json", v2), []);
  assert.equal(v2.observationId, "OBS-" + obsV1.pk.slice(8, 40), "deterministic internal identity from stored key");
  assert.equal(v2.externalReference, obsV1.reference, "receipt reference unchanged");
  assert.notEqual(v2.observationId, v2.externalReference);
  assert.deepEqual(v2.report, obsV1.report, "original report text preserved");
  assert.deepEqual(v2.product, { status: "resolved", productId: "forma-studio", reportedText: "Forma Studio" });
  assert.equal(v2.reportedImpact, "workaround");
  assert.deepEqual(v2.triage, {}, "no severity/priority/confidence inferred from reported impact");
  assert.deepEqual(v2.source, { channel: "public-api", provenance: "anonymous-human" });
  assert.deepEqual(v2.history, obsV1.history, "history carried verbatim");
  assert.equal(v2.state, obsV1.state);
  assert.equal(v2.revision, obsV1.revision);
  assert.deepEqual(v2.migration.original, obsV1, "original retained for audit");
  assert.equal(obsV1.schemaVersion, undefined, "input not mutated");
  // Deterministic
  assert.deepEqual(migrateObservationV1(registry, obsV1).value, v2);
});

test("unknown product names in historical records stay unmapped rather than reassigned", () => {
  const odd = { ...obsV1, report: { ...obsV1.report, product: "Retired Product" } };
  const v2 = migrateObservationV1(registry, odd).value;
  assert.deepEqual(v2.product, { status: "unmapped", productId: null, reportedText: "Retired Product" });
  assert.deepEqual(validateFile("observation.v2.schema.json", v2), []);
});

test("v1 defect migrates with typed ids, explicit provenance and no inferred severity", () => {
  const r = migrateDefectV1(registry, defV1);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const v2 = r.value;
  assert.deepEqual(validateFile("defect.v2.schema.json", v2), []);
  assert.equal(v2.defectId, "DEF-0007");
  assert.equal(v2.legacyId, "VIT-0007");
  assert.deepEqual(v2.externalReferences, ["VIT-00112233445566778899AABBCCDDEEFF"]);
  assert.deepEqual(v2.source, { channel: "public-github", provenance: "authenticated-human" });
  assert.equal(v2.product.productId, "helixnote");
  assert.equal(v2.reportedImpact, "workaround");
  assert.deepEqual(v2.triage, {}, "'unassessed' severity becomes absent, not a guess");
  assert.deepEqual(v2.evidence, [{ kind: "unspecified", ref: defV1.evidenceUrls[0] }], "untyped legacy evidence stays untyped");
  assert.deepEqual(v2.workItems.map(w => w.system), ["github", "github"], "GitHub is just a work-item system");
  assert.equal(v2.state, "duplicate");
  assert.deepEqual(v2.notes, { rootCause: defV1.rootCause, verification: defV1.verification });
  assert.deepEqual(v2.migration.original, defV1);
  const assessed = migrateDefectV1(registry, { ...defV1, severity: "high" }).value;
  assert.deepEqual(assessed.triage, { severity: "high" });
  assert.equal(assessed.triage.priority, undefined);
  const manual = migrateDefectV1(registry, { ...defV1, source: "manual" }).value;
  assert.equal(manual.source.provenance, "unrecorded", "provenance is not invented for manual entries");
});

test("version negotiation: v2 passes, v1 migrates, unknown versions are refused", () => {
  const v2 = migrate(registry, obsV1).value;
  assert.equal(migrate(registry, v2).value, v2);
  assert.equal(migrate(registry, defV1).value.kind, "defect");
  for (const bad of [{ ...obsV1, schemaVersion: "3.0" }, { ...defV1, schemaVersion: "0.9" }, { ...obsV1, report: { ...obsV1.report, schemaVersion: "2.0" } }, null, [], "VIT-0001"]) {
    const r = migrate(registry, bad);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "unsupported_version");
  }
  assert.equal(migrateObservationV1(registry, { ...obsV1, pk: "REQUEST#nothex" }).error.code, "invalid_record");
  assert.equal(migrateObservationV1(registry, { ...obsV1, reference: "#12" }).error.code, "invalid_record");
});

test("migrated v2 schemas refuse unexpected properties and conflated fields", () => {
  const v2 = structuredClone(migrate(registry, obsV1).value);
  assert.ok(validateFile("observation.v2.schema.json", { ...v2, severity: "high" }).length, "severity is not a top-level field");
  assert.ok(validateFile("observation.v2.schema.json", { ...v2, triage: { severity: "P1" } }).length);
  assert.ok(validateFile("observation.v2.schema.json", { ...v2, source: { channel: "public-api" } }).length, "provenance required");
  assert.ok(validateFile("observation.v2.schema.json", { ...v2, externalReference: "123" }).length);
  const d = structuredClone(migrate(registry, defV1).value);
  assert.ok(validateFile("defect.v2.schema.json", { ...d, githubIssueUrl: "https://github.com/x/y/issues/1" }).length, "no GitHub-specific fields in v2");
});
