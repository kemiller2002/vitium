// Adversarial review of the proposed machine-observation boundary (service/machine/*):
// VIT-INT-013, VIT-AC-032/035/036 (INT-015/016/017 groundwork). No route serves this
// contract; these tests attack the pure core and its injected ports.
// Tests marked { todo: "finding VF-xxx" } fail on p0/integration @ a574d44 and are findings.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { makePrincipalVerifier, isVerifiedPrincipal } from "../../service/machine/principal.mjs";
import { makeMachineIntake } from "../../service/machine/observation-core.mjs";
import { makeMemoryStore } from "../../service/machine/memory-store.mjs";
import { validateEnvelope } from "../../service/machine/contract.mjs";
import { enqueue, nextDelivery, reportWithDelivery, DEFAULT_POLICY } from "../../service/machine/outbox.mjs";
import { CANARY } from "../verification/canaries.mjs";

const NOW = "2026-10-08T16:00:00.000Z";
const ex = name => JSON.parse(readFileSync(new URL("../../schemas/machine/examples/" + name, import.meta.url), "utf8"));
const TYPES = ["observation.detected", "verification.failed", "verification.passed", "verification.inconclusive", "governance.violation"];
const CLAIMS = {
  ci: { principalId: "wl:ci:summa", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  ci2: { principalId: "wl:ci:summa-2", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  dokimos: { principalId: "wl:dokimos:summa", system: "dokimos", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: TYPES, expiresAt: "2026-10-08T17:00:00Z" }
};
const verify = makePrincipalVerifier(async c => CLAIMS[c] ? { ok: true, value: structuredClone(CLAIMS[c]) } : { ok: false, error: "invalid" });
const principal = async label => (await verify(label)).value;
let n = 0;
function harness(attempts = {}) {
  const store = makeMemoryStore();
  const lookupAttempt = async (d, a) => ({ ok: true, value: attempts[d + "#" + a] ? { found: true, author: attempts[d + "#" + a] } : { found: false } });
  return { store, intake: makeMachineIntake({ store, now: () => NOW, observationId: () => "OBS-" + (++n).toString(16).padStart(32, "0"), lookupAttempt }) };
}
const fresh = (env, patch = {}) => ({ ...structuredClone(env), eventId: crypto.randomUUID(), ...patch });
const detected = () => fresh(ex("observation-detected.ci.v1.json"));

test("VIT-INT-016: no request data, copy, clone, proxy or prototype trick yields a VerifiedPrincipal", async () => {
  const p = await principal("ci");
  const { intake, store } = harness();
  for (const forged of [{ ...p }, structuredClone(p), JSON.parse(JSON.stringify(p)), Object.create(p), new Proxy(p, {}), Object.assign(Object.create(null), p)]) {
    assert.equal(isVerifiedPrincipal(forged), false);
    const r = await intake.submit({ principal: forged, body: JSON.stringify(detected()) });
    assert.equal(r.error?.code, "invalid_principal");
  }
  assert.equal(store.records().length, 0);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.repositories), "scopes cannot be widened after verification");
});

test("VIT-INT-016: repository scope is exact (no casing, trailing-dot or look-alike widening) and environment is enforced", async () => {
  const p = await principal("ci");
  const { intake } = harness();
  for (const repository of ["KEMILLER2002/SUMMA", "kemiller2002/Summa", "kemiller2002/summa.", "kemiller2002/summa-"]) {
    const e = detected(); e.source.repository = repository;
    const r = await intake.submit({ principal: p, body: JSON.stringify(e) });
    assert.equal(r.ok, false, repository);
  }
  const prod = detected(); prod.subject.environment = "production";
  assert.equal((await intake.submit({ principal: p, body: JSON.stringify(prod) })).error?.code, "environment_not_in_scope");
});

test("VIT-AC-035: identical delivery is idempotent; same eventId with different content is a conflict", async () => {
  const p = await principal("ci");
  const { intake, store } = harness();
  const e = detected();
  const a = await intake.submit({ principal: p, body: JSON.stringify(e) });
  const b = await intake.submit({ principal: p, body: JSON.stringify(e) });
  assert.equal(a.value.ack.replayed, false);
  assert.equal(b.value.ack.replayed, true);
  assert.equal(b.value.ack.observationId, a.value.ack.observationId);
  const changed = structuredClone(e); changed.finding.summary = "Different summary text";
  assert.equal((await intake.submit({ principal: p, body: JSON.stringify(changed) })).error?.code, "event_conflict");
  assert.equal(store.records().length, 1);
});

test("VIT-AC-035 / BSR test 2: the same fingerprint on distinct commits/runs keeps two occurrences linked to one candidate", async () => {
  const p = await principal("ci");
  const { intake, store } = harness();
  const a = detected(); const b = detected();
  b.subject.commit = "a".repeat(40); b.subject.runId = "pipeline-run-999";
  await intake.submit({ principal: p, body: JSON.stringify(a) });
  await intake.submit({ principal: p, body: JSON.stringify(b) });
  const records = store.records();
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map(r => r.candidate.fingerprint)).size, 1);
  assert.deepEqual(records.map(r => r.candidate.mergeDecision), [null, null]);
});

test("VIT-AC-032 / VIT-AC-036: a passing verification is never applied; self-certification and unknown attempts are withheld", async () => {
  const pd = await principal("dokimos");
  const pass = fresh(ex("verification-passed.dokimos.v1.json"));
  const key = pass.correlation.defectId + "#" + pass.correlation.verificationAttemptId;
  for (const [name, attempts, withheld] of [
    ["self", { [key]: { principalId: "wl:dokimos:summa" } }, "self-certification"],
    ["unknown", {}, "unknown-attempt"]
  ]) {
    const { intake } = harness(attempts);
    const r = await intake.submit({ principal: pd, body: JSON.stringify(fresh(pass)) });
    assert.ok(r.ok, name);
    assert.equal(r.value.record.verification.proposal, null, name);
    assert.equal(r.value.record.verification.withheldReason, withheld, name);
    assert.equal(r.value.record.classification, "untriaged");
  }
  const { intake } = harness({ [key]: { principalId: "wl:praxis:author" } });
  const ok = await intake.submit({ principal: pd, body: JSON.stringify(fresh(pass)) });
  assert.equal(ok.value.record.verification.proposal.applied, false, "even an independent pass is only a proposal");
  assert.ok(!("state" in ok.value.record.verification.proposal));
});

test("VIT-AC-035 / VIT-INT-015: the outbox never changes the producer's build result; a mandatory reporting failure is a separate gate", () => {
  const build = Object.freeze({ status: "failed", failedTests: ["verify-abi"] });
  const out = reportWithDelivery(build, [{ eventId: "e1", status: "dead-letter", deadLetterReason: "retry-exhausted" }], { reportingMandatory: true });
  assert.equal(out.buildResult, build);
  assert.deepEqual(out.gates, [{ gate: "vitium-reporting", passed: false }]);
  assert.equal(out.buildResult.status, "failed");
});

test("VIT-AC-035: producer outage is bounded: 429/5xx retry with backoff, exhaustion and expiry dead-letter (never silently dropped)", () => {
  let e = enqueue({ eventId: "e1" }, NOW);
  for (let i = 0; i < DEFAULT_POLICY.maxAttempts; i += 1) e = nextDelivery(e, NOW, DEFAULT_POLICY, { kind: "response", status: 503 }).value;
  assert.equal(e.status, "dead-letter");
  assert.equal(e.deadLetterReason, "retry-exhausted");
  const expired = nextDelivery(enqueue({ eventId: "e2" }, NOW), "2026-10-10T00:00:00.000Z").value;
  assert.equal(expired.status, "dead-letter");
});

// ---- findings ---------------------------------------------------------------------------

test("VIT-INT-013: inherited-name keys (constructor, toString, __proto__, valueOf) are refused like any unexpected field, and never stored", async () => {
  const p = await principal("ci");
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const text = JSON.stringify(detected()).replace("{", `{"${key}":{"note":"${CANARY.githubClassic}"},`);
    assert.equal(validateEnvelope(JSON.parse(text)).ok, false, "runtime validator accepted top-level " + key);
    const { intake, store } = harness();
    const r = await intake.submit({ principal: p, body: text });
    assert.equal(r.ok, false, key);
    assert.ok(!JSON.stringify(store.records()).includes(CANARY.githubClassic), key + " smuggled an unredacted credential into storage");
  }
  const nested = JSON.stringify(detected()).replace('"finding":{', '"finding":{"constructor":"x",');
  assert.equal(validateEnvelope(JSON.parse(nested)).ok, false, "nested finding.constructor accepted");
});

test("VIT-INT-015: a non-Vitium producer cannot suppress its own legitimate event by setting a vitium origin marker", async () => {
  const p = await principal("ci");
  const { intake, store } = harness();
  const e = detected(); e.correlation.originMarker = "vitium/spoof";
  const r = await intake.submit({ principal: p, body: JSON.stringify(e) });
  assert.ok(!(r.ok && r.value.disposition === "echo-suppressed" && store.records().length === 0),
    "an authenticated CI event was silently dropped (no record, no conflict) because the body claimed a Vitium origin");
});

test("VIT-AC-035: an eventId replayed by a DIFFERENT principal is not acknowledged as that principal's delivery", async () => {
  const { intake } = harness();
  const e = detected();
  await intake.submit({ principal: await principal("ci"), body: JSON.stringify(e) });
  const other = await intake.submit({ principal: await principal("ci2"), body: JSON.stringify(e) });
  assert.ok(!(other.ok && other.value.ack?.replayed === true), "principal wl:ci:summa-2 received a replay ack for wl:ci:summa's event");
});

test("VIT-VER-010 / VIT-AC-036: after an inconclusive machine result the same attempt can still record a pass or failure", async () => {
  const pd = await principal("dokimos");
  const pass = fresh(ex("verification-passed.dokimos.v1.json"));
  const key = pass.correlation.defectId + "#" + pass.correlation.verificationAttemptId;
  const { intake } = harness({ [key]: { principalId: "wl:praxis:author" } });
  const inconclusive = fresh(pass, { eventType: "verification.inconclusive", observedAt: "2026-10-08T15:00:00Z" });
  inconclusive.finding = { ...inconclusive.finding, category: "infrastructure-error" };
  assert.ok((await intake.submit({ principal: pd, body: JSON.stringify(inconclusive) })).ok);
  const rerun = await intake.submit({ principal: pd, body: JSON.stringify(fresh(pass, { observedAt: "2026-10-08T15:30:00Z" })) });
  assert.equal(rerun.ok, true, "re-run refused: " + rerun.error?.code + " (lifecycle allows it, DOM-001 §19)");
});

test("VIT-AC-035: the outbox only marks an entry delivered when the response acknowledges THAT eventId", () => {
  const e = enqueue({ eventId: "e1" }, NOW);
  for (const body of ["<html>captive portal</html>", { eventId: "OTHER", status: "recorded" }, {}]) {
    const r = nextDelivery(e, NOW, DEFAULT_POLICY, { kind: "response", status: 200, body });
    assert.notEqual(r.value.status, "delivered", JSON.stringify(body));
  }
});


test("VIT-INT-013: runtime validator and JSON Schema agree on inherited-name keys (schema/runtime parity)", () => {
  const require = createRequire(import.meta.url);
  const Ajv = require("ajv/dist/2020.js"); const formats = require("ajv-formats");
  const ajv = new Ajv({ strict: false, allErrors: true }); formats(ajv);
  const schema = JSON.parse(readFileSync(new URL("../../schemas/machine/observation-envelope.v1.schema.json", import.meta.url), "utf8"));
  const check = ajv.compile(schema);
  const raw = JSON.parse(JSON.stringify(detected()).replace("{", '{"constructor":1,'));
  assert.equal(validateEnvelope(raw).ok, check(raw));
});
