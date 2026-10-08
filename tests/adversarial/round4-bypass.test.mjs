// Fix round 4: one bypass variant per closed finding VF-025..VF-033 that the original
// round-3 test did not cover. Passing tests confirm the fix generalises; { todo } tests are
// new findings (VF-034..VF-036) on p0/integration @ ef8f359.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { table, tryTransition } from "../../service/triage.mjs";
import { evaluateTransition } from "../../service/lifecycle.mjs";
import { decide } from "../../service/triage-cli.mjs";
import { makePrincipalVerifier } from "../../service/machine/principal.mjs";
import { makeMachineIntake } from "../../service/machine/observation-core.mjs";
import { makeMemoryStore } from "../../service/machine/memory-store.mjs";
import { enqueue, nextDelivery, DEFAULT_POLICY } from "../../service/machine/outbox.mjs";
import { CANARY } from "../verification/canaries.mjs";

const ts = "2026-10-08T12:00:00.000Z";
const HUMAN = { context: { provenance: "authenticated-human" } };
const start = () => ({ kind: "defect", state: "in-progress", revision: 0, history: [] });
const run = (rec, cmd, opts) => evaluateTransition(table, rec, { expectedRevision: rec.revision, occurredAt: ts, reason: "r", ...cmd }, opts);
const submit = (actor, a, c, extra = {}) => ({ to: "awaiting-verification", actor, role: "triager", fields: { attemptId: a, candidateRevision: c, ...extra }, evidence: [{ kind: "verification-request", ref: "vr-" + a }] });
const verdict = (to, actor, a, c) => ({ to, actor, role: "verifier", fields: { attemptId: a, candidateRevision: c }, evidence: [{ kind: "verification-run", ref: "run-" + a }] });
const legacy = (rec, to, actor, role, a, c, extra = {}) => tryTransition(rec, { to, actor, role, reason: "r", expectedRevision: rec.revision, occurredAt: ts, attemptId: a, candidateRevision: c, evidenceId: "ev-" + a, ...extra });

// ---- domain variants -------------------------------------------------------------------

test("VF-025 variant: the legacy shape cannot name a different author either", () => {
  const r = legacy(start(), "awaiting-verification", "dev-1", "triager", "L1", "c1", { author: "someone-else" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "author_mismatch");
});

test("VF-026 variant: homoglyph, zero-width, full-width and non-ASCII-hyphen aliases never reach the comparison", () => {
  const awaiting = run(start(), submit("dev-1", "H1", "c1"), HUMAN).value.record;
  for (const alias of ["dev‑1", "дev-1", "dev-1​", "ｄｅｖ-1", "DEV‐1"]) {
    const r = run(awaiting, verdict("resolved", alias, "H1", "c1"), HUMAN);
    assert.equal(r.ok, false, JSON.stringify(alias));
  }
  for (const alias of ["DEV-1", " dev-1".trim(), "Dev-1"]) {
    assert.equal(run(awaiting, verdict("resolved", alias, "H1", "c1"), HUMAN).error?.code, "independence_required", alias);
  }
});

test("VF-027 variant: without a trusted context, a body claiming authenticated-human is still budgeted as autonomous", () => {
  let rec = start();
  for (let i = 1; i <= 3; i += 1) {
    rec = run(rec, { ...submit("bot", "B" + i, "c" + i), provenance: "agent" }).value.record;
    rec = run(rec, verdict("in-progress", "v-1", "B" + i, "c" + i), HUMAN).value.record;
  }
  assert.equal(run(rec, { ...submit("bot", "B4", "c4"), provenance: "authenticated-human" }).error?.code, "escalation_required");
  assert.equal(run(rec, { ...submit("bot", "B4", "c4"), provenance: "agent" }, HUMAN).error?.code, "provenance_conflict");
});

test("VF-028 variant: ci and application contexts cannot pass either; strict shape without provenance is refused", () => {
  const awaiting = run(start(), submit("dev-1", "G1", "c1"), HUMAN).value.record;
  for (const provenance of ["agent", "ci", "application"]) {
    assert.equal(run(awaiting, verdict("resolved", "v-x", "G1", "c1"), { context: { provenance } }).error?.code, "human_verifier_required", provenance);
  }
  assert.equal(run(awaiting, verdict("resolved", "v-x", "G1", "c1")).error?.code, "invalid_provenance");
});

// Residual on the documented legacy path (DOM-001 s.25/s.28): no service code calls it,
// but the exported function still lets one actor submit and pass, and lets any actor pass.
test("VIT-AC-036 / VIT-VER-006: no exported lifecycle entry point lets an actor pass its own attempt or lets an unattested actor pass", { todo: "finding VF-034" }, () => {
  const sub = legacy(start(), "awaiting-verification", "dev-1", "triager", "S1", "c1");
  assert.ok(sub.ok);
  const self = legacy(sub.value.record, "resolved", "dev-1", "verifier", "S1", "c1");
  assert.equal(self.ok, false, "legacy shape: dev-1 submitted and passed its own candidate");
  const strict = run(start(), submit("dev-2", "S2", "c2"), HUMAN).value.record;
  assert.equal(legacy(strict, "resolved", "dev-2", "verifier", "S2", "c2").ok, false, "legacy pass of a strict submission by its author");
});

// triage-cli maps EVERY IAM principal to authenticated-human (OPERATOR_PROVENANCE). An agent
// workload's role session therefore escapes both the repair budget and the human-verifier rule.
test("mission §7 gate 4 / VIT-VER-011: the triage-cli boundary does not grant authenticated-human to a non-human IAM workload", () => {
  let rec = start();
  for (let i = 1; i <= 3; i += 1) {
    rec = run(rec, { ...submit("bot", "B" + i, "c" + i), provenance: "agent" }).value.record;
    rec = run(rec, verdict("in-progress", "v-1", "B" + i, "c" + i), HUMAN).value.record;
  }
  const args = { command: "advance", to: "awaiting-verification", reason: "retry", role: "triager", fields: { attemptId: "B4", candidateRevision: "c4" }, evidence: [{ kind: "verification-request", ref: "vr" }] };
  const agentSession = "arn:aws:sts::123456789012:assumed-role/praxis-agent-runner/session-1";
  const r = decide({ args, record: { kind: "defect", id: "DEF-0001", state: rec.state, revision: rec.revision, history: rec.history }, actor: agentSession, occurredAt: ts });
  assert.equal(r.ok, false, "an assumed-role agent session submitted past the exhausted repair budget as authenticated-human");
});

// ---- machine variants -------------------------------------------------------------------

const NOW = "2026-10-08T16:00:00.000Z";
const TYPES = ["observation.detected", "verification.failed", "verification.passed", "verification.inconclusive", "governance.violation"];
const CLAIMS = {
  ci: { principalId: "wl:ci:summa", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  ci2: { principalId: "wl:ci:summa-2", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  dokimos: { principalId: "wl:dokimos:summa", system: "dokimos", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: TYPES, expiresAt: "2026-10-08T17:00:00Z" }
};
const verify = makePrincipalVerifier(async c => CLAIMS[c] ? { ok: true, value: structuredClone(CLAIMS[c]) } : { ok: false, error: "invalid" });
const principal = async l => (await verify(l)).value;
const ex = name => JSON.parse(readFileSync(new URL("../../schemas/machine/examples/" + name, import.meta.url), "utf8"));
let n = 0;
function harness(attempts = {}) {
  const store = makeMemoryStore();
  const lookupAttempt = async (d, a) => ({ ok: true, value: attempts[d + "#" + a] ? { found: true, author: attempts[d + "#" + a] } : { found: false } });
  return { store, intake: makeMachineIntake({ store, now: () => NOW, observationId: () => "OBS-" + (++n).toString(16).padStart(32, "0"), lookupAttempt }) };
}
const detected = () => ({ ...ex("observation-detected.ci.v1.json"), eventId: crypto.randomUUID() });

test("VF-029 variant: inherited-name keys inside evidence items, subject and correlation are refused and never stored", async () => {
  const p = await principal("ci");
  const base = JSON.stringify(detected());
  for (const [where, text] of [
    ["evidence[0].constructor", base.replace('"evidence":[{', `"evidence":[{"constructor":"${CANARY.githubClassic}",`)],
    ["evidence[0].__proto__", base.replace('"evidence":[{', `"evidence":[{"__proto__":{"x":"${CANARY.githubClassic}"},`)],
    ["subject.toString", base.replace('"subject":{', '"subject":{"toString":"x",')],
    ["correlation.hasOwnProperty", base.replace('"correlation":{', '"correlation":{"hasOwnProperty":"x",')]
  ]) {
    assert.notEqual(text, base, "fixture substitution applied for " + where);
    const { intake, store } = harness();
    const r = await intake.submit({ principal: p, body: text });
    assert.equal(r.error?.code, "invalid_envelope", where);
    assert.ok(!JSON.stringify(store.records()).includes(CANARY.githubClassic), where);
  }
});

test("VF-030 variant: marker casing variants are refused by the pattern; only a Vitium principal is treated as an echo", async () => {
  const p = await principal("ci");
  for (const [marker, code] of [["Vitium/x", "invalid_envelope"], ["VITIUM/x", "invalid_envelope"], ["vitium/x", "spoofed_echo_marker"]]) {
    const { intake, store } = harness();
    const e = detected(); e.correlation.originMarker = marker;
    const r = await intake.submit({ principal: p, body: JSON.stringify(e) });
    assert.equal(r.error?.code, code, marker);
    assert.equal(store.records().length, 0);
  }
});

test("VF-031 variant: a different principal is refused whether or not the content matches, and an upper-cased eventId is not a second key", async () => {
  const { intake } = harness();
  const e = detected();
  await intake.submit({ principal: await principal("ci"), body: JSON.stringify(e) });
  const changed = structuredClone(e); changed.finding.summary = "Other text entirely";
  const a = await intake.submit({ principal: await principal("ci2"), body: JSON.stringify(e) });
  const b = await intake.submit({ principal: await principal("ci2"), body: JSON.stringify(changed) });
  assert.equal(a.error?.code, "event_conflict");
  assert.deepEqual(a.error, b.error, "same response for same/different content: nothing stored is disclosed");
  const upper = { ...structuredClone(e), eventId: e.eventId.toUpperCase() };
  assert.equal((await intake.submit({ principal: await principal("ci"), body: JSON.stringify(upper) })).error?.code, "invalid_envelope");
});

test("VF-032 variant: inconclusive leaves the attempt open, but a second CONCLUSIVE result is still refused", async () => {
  const pd = await principal("dokimos");
  const pass = ex("verification-passed.dokimos.v1.json");
  const key = pass.correlation.defectId + "#" + pass.correlation.verificationAttemptId;
  const { intake } = harness({ [key]: { principalId: "wl:praxis:author" } });
  const mk = (eventType, observedAt, category) => ({ ...structuredClone(pass), eventId: crypto.randomUUID(), eventType, observedAt, finding: { ...pass.finding, ...(category ? { category } : {}) } });
  assert.ok((await intake.submit({ principal: pd, body: JSON.stringify(mk("verification.passed", "2026-10-08T15:00:00Z")) })).ok);
  assert.equal((await intake.submit({ principal: pd, body: JSON.stringify(mk("verification.failed", "2026-10-08T15:30:00Z")) })).error?.code, "attempt_conflict");
  assert.ok((await intake.submit({ principal: pd, body: JSON.stringify(mk("verification.inconclusive", "2026-10-08T15:40:00Z", "infrastructure-error")) })).ok);
});

test("VF-033 variant: with the producer principal known, an ack naming another principal, a non-recorded status or a case-variant eventId is not delivery", () => {
  const e = enqueue({ eventId: "e1" }, NOW, "wl:ci:summa");
  const good = { schemaVersion: "1.0", eventId: "e1", principalId: "wl:ci:summa", observationId: "OBS-1", receivedAt: NOW, status: "recorded", replayed: false };
  assert.equal(nextDelivery(e, NOW, DEFAULT_POLICY, { kind: "response", status: 200, body: good }).value.status, "delivered");
  for (const body of [{ ...good, principalId: "wl:other" }, { ...good, status: "echo-suppressed" }, { ...good, eventId: "E1" }, [good]]) {
    assert.notEqual(nextDelivery(e, NOW, DEFAULT_POLICY, { kind: "response", status: 200, body }).value.status, "delivered", JSON.stringify(body).slice(0, 60));
  }
});

test("VIT-AC-035: an outbox entry without a known principal does not accept an ack issued to a different principal", () => {
  const e = enqueue({ eventId: "e2" }, NOW);
  const foreign = { schemaVersion: "1.0", eventId: "e2", principalId: "wl:someone-else", observationId: "OBS-9", receivedAt: NOW, status: "recorded", replayed: true };
  assert.notEqual(nextDelivery(e, NOW, DEFAULT_POLICY, { kind: "response", status: 200, body: foreign }).value.status, "delivered");
});
