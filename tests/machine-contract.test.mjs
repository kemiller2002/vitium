import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as contract from "../service/machine-observation.mjs";
import { eventFields, roles, actorKinds, verificationOutcomes, inconclusiveCauses, transition } from "../service/triage.mjs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const machineSchema = JSON.parse(read("schemas/machine-observation.schema.json"));
const defectSchema = JSON.parse(read("schemas/defect.schema.json"));
const sorted = list => [...list].sort();

test("machine observation schema and runtime validator share every enumeration", () => {
  const p = machineSchema.properties;
  assert.deepEqual(sorted(p.eventType.enum), sorted(contract.eventTypes));
  assert.deepEqual(sorted(p.source.properties.system.enum), sorted(contract.sourceSystems));
  assert.deepEqual(sorted(p.subject.properties.environment.enum), sorted(contract.environments));
  assert.deepEqual(sorted(p.finding.properties.category.enum), sorted(contract.categories));
  assert.deepEqual(sorted(p.finding.properties.confidence.enum), sorted(contract.confidences));
  assert.deepEqual(sorted(p.evidence.items.properties.kind.enum), sorted(contract.evidenceKinds));
  assert.equal(p.finding.properties.classification.const, contract.producerClassification);
  assert.equal(p.schemaVersion.const, contract.machineSchemaVersion);
  assert.equal(p.evidence.maxItems, contract.limits.maxEvidence);
  assert.equal(machineSchema.additionalProperties, false);
  for (const key of ["source", "subject", "finding", "correlation"]) assert.equal(p[key].additionalProperties, false, key);
});

test("schema-required envelope fields are exactly those the validator refuses to omit", () => {
  const sample = {
    schemaVersion: "1.0", eventId: "0276f8ac-a673-4d62-85a7-5d2292ef0cdd", eventType: "observation.detected",
    source: { system: "ci", repository: "kemiller2002/vitium", installationId: "ci-1", version: "1.0.0" },
    subject: { commit: "f6a987d3c71ad2f4ced1711528e296a42c51d9f4", runId: "r-1", checkId: "c-1", environment: "ci" },
    finding: { category: "test-failure", summary: "s", expected: "e", observed: "o", classification: "untriaged", confidence: "observed" },
    evidence: [{ kind: "check-run", uri: "https://example.com/run/1", sha256: "a".repeat(64) }],
    observedAt: "2026-10-08T12:00:00Z"
  };
  const now = "2026-10-08T12:00:00.000Z";
  assert.equal(contract.normalizeMachineObservation(sample, now).eventId, sample.eventId);
  for (const key of machineSchema.required) {
    const { [key]: _omitted, ...rest } = sample;
    assert.throws(() => contract.normalizeMachineObservation(rest, now), contract.ObservationError, "accepted without " + key);
  }
});

test("defect schema describes exactly the lifecycle event the transition module produces", () => {
  const event = defectSchema.$defs.lifecycleEvent;
  assert.deepEqual(sorted(Object.keys(event.properties)), sorted(eventFields));
  assert.equal(event.additionalProperties, false);
  assert.deepEqual(sorted(event.properties.role.enum), sorted(roles));
  assert.deepEqual(sorted(event.properties.actorKind.enum), sorted(actorKinds));
  assert.deepEqual(sorted(event.properties.verificationOutcome.enum.filter(Boolean)), sorted(verificationOutcomes));
  assert.deepEqual(sorted(event.properties.inconclusiveCause.enum.filter(Boolean)), sorted(inconclusiveCauses));
  const produced = transition({ kind: "defect", state: "new", revision: 0, history: [] },
    { to: "triaged", actor: "a", role: "triager", reason: "r", expectedRevision: 0, occurredAt: "2026-10-08T12:00:00Z" }).history[0];
  assert.deepEqual(Object.keys(produced), [...eventFields]);
  for (const key of event.required) assert.notEqual(produced[key], null, key);
});

test("no machine endpoint is deployed or reachable from the public site", () => {
  const template = read("infra/aws/template.yaml");
  assert.doesNotMatch(template, /\/api\/v1\/observations/);
  assert.doesNotMatch(read("service/aws-handler.mjs"), /machine-/);
  for (const file of readdirSync(new URL("../site/", import.meta.url))) {
    assert.doesNotMatch(read("site/" + file), /api\/v1\/observations|machine-observation/, file);
  }
  assert.doesNotMatch(read("service/http.mjs"), /observations/);
});

test("documentation does not claim the machine API, producers or Ordo authority are deployed", () => {
  const spec = read("docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md");
  const state = read("context/CURRENT-STATE.md");
  assert.match(spec, /not a deployed service/i);
  assert.match(state, /No authenticated machine intake service or upstream emitter has been (?:shipped|deployed)/i);
  assert.match(read("service/triage.mjs"), /NOT Ordo authority/);
});
