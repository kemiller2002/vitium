// Product registry and typed identity tests (VIT-DOM-001/002/004/005/006, VIT-INT-001, VIT-AC-010).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRegistry, resolveProduct, resolveImpact, productDisplayNames, impactDisplayNames, aliasKey } from "../service/product-registry.mjs";
import { products, impacts } from "../service/report-domain.mjs";
import { PRODUCTS, IMPACTS } from "../site/submission.mjs";
import { ObservationId, ExternalReference, DefectId, ProductId, Actor, identityPatterns } from "../service/domain-records.mjs";

const raw = JSON.parse(readFileSync(new URL("../schemas/products.v1.json", import.meta.url), "utf8"));
const registry = (() => { const r = loadRegistry(raw); assert.ok(r.ok, JSON.stringify(r.error)); return r.value; })();

test("VIT-INT-001: site list, service list and canonical registry never diverge", () => {
  assert.deepEqual(productDisplayNames(registry), [...products], "service/report-domain.mjs products");
  assert.deepEqual(productDisplayNames(registry), [...PRODUCTS], "site/submission.mjs PRODUCTS");
  assert.deepEqual(impactDisplayNames(registry), [...impacts]);
  assert.deepEqual(impactDisplayNames(registry), [...IMPACTS]);
  // Plausible drift: adding a product to only one side must be detectable by this test.
  assert.notDeepEqual(productDisplayNames(registry), [...PRODUCTS, "Nova"]);
});

test("registry resolves ids, display names and aliases deterministically", () => {
  assert.deepEqual(resolveProduct(registry, "Forma Studio").value, { id: "forma-studio", displayName: "Forma Studio", unknown: false, matchedAlias: false });
  assert.equal(resolveProduct(registry, "forma-studio").value.id, "forma-studio");
  assert.equal(resolveProduct(registry, "  forma   STUDIO ").value.id, "forma-studio", "whitespace/case normalised");
  const renamed = resolveProduct(registry, "State Directed Engineering");
  assert.equal(renamed.value.id, "ordo");
  assert.equal(renamed.value.matchedAlias, true, "alias resolution is visible to callers");
  assert.equal(resolveProduct(registry, "ｓｄｅ").value.id, "ordo", "NFKC full-width folding");
  assert.equal(aliasKey(" A\tB "), "a b");
});

test("unknown and unsupported products: explicit unknown accepted, others refused not remapped", () => {
  const unknown = resolveProduct(registry, "Other / not sure");
  assert.equal(unknown.value.id, "unknown");
  assert.equal(unknown.value.unknown, true);
  for (const bad of ["Formaa", "Forma Studio Pro", "Github", "", "   ", "Ordo\u0000", "x".repeat(101), null, 7]) {
    const r = resolveProduct(registry, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error.code, /unsupported_product|product_required/);
  }
});

test("registry loading fails closed on ambiguity or a missing explicit unknown", () => {
  const clash = structuredClone(raw); clash.products[0].aliases = ["Forma"];
  assert.match(loadRegistry(clash).error.message, /ambiguous/);
  const noUnknown = structuredClone(raw); noUnknown.products = noUnknown.products.filter(p => !p.unknown);
  assert.match(loadRegistry(noUnknown).error.message, /unknown/);
  const dupId = structuredClone(raw); dupId.products.push({ ...dupId.products[0], displayName: "Arca 2" });
  assert.match(loadRegistry(dupId).error.message, /Duplicate product id/);
  assert.equal(loadRegistry({ ...raw, schemaVersion: "2.0" }).ok, false);
});

test("reported impact resolves by id or display name, never to severity/priority", () => {
  assert.equal(resolveImpact(registry, "Cannot use the feature").value.id, "cannot-use");
  assert.equal(resolveImpact(registry, "minor").value.displayName, "Minor inconvenience or display problem");
  assert.equal(resolveImpact(registry, "critical").ok, false);
  assert.ok(!registry.impacts.some(i => "severity" in i || "priority" in i));
});

test("identity kinds are distinct and cannot be substituted for each other", () => {
  const samples = {
    observationId: "OBS-0123456789abcdef0123456789abcdef",
    externalReference: "VIT-0123456789ABCDEF0123456789ABCDEF",
    defectId: "DEF-0042",
    productId: "forma-studio"
  };
  const ctors = { observationId: ObservationId, externalReference: ExternalReference, defectId: DefectId, productId: ProductId };
  for (const [kind, ctor] of Object.entries(ctors)) {
    for (const [sampleKind, sample] of Object.entries(samples)) {
      assert.equal(ctor(sample).ok, kind === sampleKind, kind + " vs " + sampleKind);
    }
  }
  assert.equal(ExternalReference("VIT-0001").ok, false, "legacy defect id is not an external reference");
  assert.equal(ExternalReference("#123").ok, false, "GitHub issue numbers are not references");
  assert.equal(DefectId("VIT-0001").ok, false);
  assert.ok(!identityPatterns.externalReference.test("12"));
});

test("actor requires an identity and an explicit provenance class (VIT-DOM-005)", () => {
  assert.deepEqual(Actor("ci-runner-1", "ci").value, { id: "ci-runner-1", provenance: "ci" });
  assert.equal(Actor("agent:claude", "agent").ok, true);
  assert.equal(Actor("ci-runner-1", "robot").error.code, "invalid_provenance");
  assert.equal(Actor("ci-runner-1", "unrecorded").ok, false, "unrecorded is migration-only");
  assert.equal(Actor("", "ci").ok, false);
  assert.equal(Actor("has space", "ci").ok, false);
});
