// Machine-observation intake core (VIT-INT-013/015/017, VIT-DOM-005, VIT-AC-032/035/036).
// Requirements doc "Required tests" items 1, 2, 3, 7 and 8 at the Vitium core level.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  makeMachineIntake, fingerprint, canonicalJson, mayProjectPublicly, looksLikeLogDump, decidePut
} from "../service/machine/observation-core.mjs";
import { validateEnvelope, BOUNDS } from "../service/machine/contract.mjs";
import { MACHINE_ERROR_CODES, machineFailure } from "../service/machine/errors.mjs";
import { NOW, example, body, principal, harness } from "./machine-fixtures.mjs";

const FORBIDDEN_STATES = ["resolved", "closed", "confirmed", "in-progress", "triaged", "reproducing", "awaiting-verification", "reopened"];
const v4 = () => crypto.randomUUID();
const withRun = (name, run, commit) => {
  const v = example(name);
  v.eventId = v4();
  v.subject.runId = run;
  if (commit) v.subject.commit = commit;
  return v;
};

// ---- item 1: idempotency ---------------------------------------------------------------

test("item 1: two identical observation.detected deliveries -> one observation, two equal acks", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const b = body(example("observation-detected.ci.v1.json"));
  const first = await intake.submit({ principal: p, body: b });
  const second = await intake.submit({ principal: p, body: b });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(store.records().length, 1, "no second authoritative record");
  assert.equal(first.value.ack.replayed, false);
  assert.equal(second.value.ack.replayed, true);
  const strip = a => ({ ...a, replayed: undefined });
  assert.deepEqual(strip(second.value.ack), strip(first.value.ack), "same ack identity");
  assert.equal(second.value.record, undefined, "a replay returns no new record");
});

test("idempotency ignores JSON key order and whitespace (canonical hash)", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const v = example("observation-detected.ci.v1.json");
  const reordered = Object.fromEntries(Object.entries(v).reverse());
  reordered.source = Object.fromEntries(Object.entries(v.source).reverse());
  assert.ok((await intake.submit({ principal: p, body: JSON.stringify(v) })).ok);
  const r = await intake.submit({ principal: p, body: JSON.stringify(reordered, null, 4) });
  assert.equal(r.ok, true);
  assert.equal(r.value.ack.replayed, true);
  assert.equal(store.records().length, 1);
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
});

test("same eventId with different content is a conflict that reveals nothing stored", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const v = example("observation-detected.ci.v1.json");
  assert.ok((await intake.submit({ principal: p, body: body(v) })).ok);
  v.finding.observed = "A different observation under a reused eventId";
  const r = await intake.submit({ principal: p, body: body(v) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "event_conflict");
  assert.equal(r.error.status, 409);
  assert.deepEqual(Object.keys(r.error).sort(), ["category", "code", "message", "retryable", "status"]);
  assert.equal(store.records().length, 1);
});

test("concurrent identical deliveries produce exactly one record (conditional put)", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const b = body(example("observation-detected.ci.v1.json"));
  const results = await Promise.all(Array.from({ length: 25 }, () => intake.submit({ principal: p, body: b })));
  assert.ok(results.every(r => r.ok));
  assert.equal(results.filter(r => !r.value.ack.replayed).length, 1);
  assert.equal(store.records().length, 1);
  assert.equal(new Set(results.map(r => r.value.ack.observationId)).size, 1);
});

// ---- item 2: occurrences vs candidates ---------------------------------------------------

test("item 2: same fingerprint on distinct runs/commits -> two occurrences linked to one candidate", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const a = withRun("observation-detected.ci.v1.json", "pipeline-run-123");
  const b = withRun("observation-detected.ci.v1.json", "pipeline-run-200", "0123456789abcdef0123456789abcdef01234567");
  const ra = await intake.submit({ principal: p, body: body(a) });
  const rb = await intake.submit({ principal: p, body: body(b) });
  assert.ok(ra.ok && rb.ok);
  assert.notEqual(ra.value.ack.observationId, rb.value.ack.observationId);
  const records = store.records();
  assert.equal(records.length, 2, "evidence is not collapsed");
  assert.equal(records[0].candidate.fingerprint, records[1].candidate.fingerprint);
  assert.equal(records[0].candidate.kind, "duplicate-candidate");
  assert.equal(records[0].candidate.mergeDecision, null, "a fingerprint is never a merge decision");
  assert.deepEqual(records.map(r => r.occurrence.runId).sort(), ["pipeline-run-123", "pipeline-run-200"]);
  assert.equal(store.byFingerprint(records[0].candidate.fingerprint).length, 2);
});

test("fingerprint: volatile numbers/hashes do not split; check, category or repository do", () => {
  const base = validateEnvelope(example("observation-detected.ci.v1.json")).value;
  const vary = patch => fingerprint({ ...base, ...patch(base) });
  const fp = fingerprint(base);
  assert.equal(vary(b => ({ finding: { ...b.finding, observed: "Binding assertion failed" }, subject: { ...b.subject, runId: "x-9", commit: "a".repeat(40) } })), fp);
  const n1 = vary(b => ({ finding: { ...b.finding, observed: "Assertion failed after 1530 ms at 0xdeadbeef" } }));
  const n2 = vary(b => ({ finding: { ...b.finding, observed: "Assertion failed after 87 ms at 0xc0ffee12" } }));
  assert.equal(n1, n2);
  assert.notEqual(vary(b => ({ subject: { ...b.subject, checkId: "verify-other" } })), fp);
  assert.notEqual(vary(b => ({ finding: { ...b.finding, category: "build-failure" } })), fp);
  assert.notEqual(vary(b => ({ source: { ...b.source, repository: "kemiller2002/other" } })), fp);
  assert.match(fp, /^FP-[0-9a-f]{64}$/);
});

// ---- item 3: fail safely ----------------------------------------------------------------

test("item 3: unavailable store, throwing store and throttled store fail closed and retryable", async () => {
  const p = await principal("label-ci");
  const b = body(example("observation-detected.ci.v1.json"));
  for (const [fault, code, status] of [["unavailable", "storage_unavailable", 503], ["throw", "storage_unavailable", 503], ["throttled", "throttled", 429]]) {
    const { intake, store } = harness({ faults: { put: fault } });
    const r = await intake.submit({ principal: p, body: b });
    assert.equal(r.ok, false, fault);
    assert.equal(r.error.code, code);
    assert.equal(r.error.status, status);
    assert.equal(r.error.retryable, true);
    assert.equal(store.records().length, 0);
  }
  assert.equal(decidePut({}, "garbage").error.code, "storage_unavailable");
  assert.equal(decidePut({}, { ok: true, value: { created: false } }).error.code, "storage_unavailable");
  assert.equal(decidePut({}, { ok: true, value: { created: false, existing: {} } }).error.code, "storage_unavailable");
});

test("item 3: out-of-order delivery (cause not yet recorded) is refused retryably, then accepted in order", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const cause = example("observation-detected.ci.v1.json");
  const effect = withRun("observation-detected.ci.v1.json", "pipeline-run-124");
  effect.correlation.causationEventId = cause.eventId;
  const early = await intake.submit({ principal: p, body: body(effect) });
  assert.equal(early.error.code, "causation_unknown");
  assert.equal(early.error.retryable, true);
  assert.equal(store.records().length, 0);
  assert.ok((await intake.submit({ principal: p, body: body(cause) })).ok);
  assert.ok((await intake.submit({ principal: p, body: body(effect) })).ok);
  assert.equal(store.records().length, 2);
  const { intake: down } = harness({ faults: { lookup: "unavailable" } });
  assert.equal((await down.submit({ principal: p, body: body(effect) })).error.code, "storage_unavailable");
});

test("item 3: stale verification event for an already-recorded attempt is refused; newer conflicting result is a conflict", async () => {
  const attempts = { "DEF-0042#VA-0042-2": { principalId: "wl:praxis:agent-7" } };
  const { intake, store } = harness({ attempts });
  const p = await principal("label-dokimos");
  const passed = example("verification-passed.dokimos.v1.json"); // observedAt 15:00
  assert.ok((await intake.submit({ principal: p, body: body(passed) })).ok);
  const olderFail = example("verification-failed.dokimos.v1.json");
  olderFail.correlation.verificationAttemptId = "VA-0042-2";
  olderFail.observedAt = "2026-10-08T14:00:00Z";
  const stale = await intake.submit({ principal: p, body: body(olderFail) });
  assert.equal(stale.error.code, "stale_event");
  const newerFail = { ...olderFail, eventId: v4(), observedAt: "2026-10-08T15:30:00Z" };
  assert.equal((await intake.submit({ principal: p, body: body(newerFail) })).error.code, "attempt_conflict");
  assert.equal(store.records().length, 1, "first recorded result for an attempt is never overwritten");
});

test("item 3: unsafe evidence and oversized/malformed payloads are refused with typed codes", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const code = async v => (await intake.submit({ principal: p, body: typeof v === "string" ? v : body(v) })).error?.code;
  const ev = uri => { const v = example("observation-detected.ci.v1.json"); v.evidence[0].uri = uri; return v; };
  assert.equal(await code(ev("http://github.com/x/y")), "unsafe_evidence");
  assert.equal(await code(ev("https://github.com/x/y?sig=abc")), "unsafe_evidence");
  assert.equal(await code(ev(["https://u", ":p@github.com/x"].join(""))), "unsafe_evidence");
  // A token-shaped path segment passes the URI grammar but is caught by the shared redactor.
  const tokenPath = ["https://github.com/x/", "gh", "p_", "A".repeat(36)].join("");
  assert.equal(await code(ev(tokenPath)), "unsafe_evidence");
  assert.equal(await code("{oops"), "invalid_json");
  assert.equal(await code("x".repeat(BOUNDS.maxBodyBytes + 1)), "payload_too_large");
  assert.equal((await intake.submit({ principal: p, body: 42 })).error.code, "invalid_json", "non-text body");
  assert.equal(await code("42"), "invalid_envelope");
  const v = example("observation-detected.ci.v1.json");
  v.schemaVersion = "0.9";
  assert.equal(await code(v), "unsupported_version");
  assert.equal(store.records().length, 0);
});

test("full log dumps and stack traces are refused, not stored", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const dumps = [
    "TypeError: x at run (/srv/app/a.js:10:5) at main (/srv/app/b.js:20:7)",
    "Traceback (most recent call last): File app.py line 3",
    "2026-10-08T12:00:00Z ERROR boot failed 2026-10-08T12:00:01Z ERROR retry failed",
    "at com.x.Y.run(Y.java:10) at com.x.Z.main(Z.java:3)"
  ];
  for (const d of dumps) {
    assert.equal(looksLikeLogDump(d), true, d);
    const v = example("observation-detected.ci.v1.json");
    v.finding.observed = d;
    assert.equal((await intake.submit({ principal: p, body: body(v) })).error.code, "log_dump_refused");
  }
  assert.equal(looksLikeLogDump("Binding assertion failed at route 7"), false);
  assert.equal(store.records().length, 0);
});

test("credentials in finding text are redacted before hashing/storage and the observation is quarantined", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  const secret = ["AK", "IA", "Q".repeat(16)].join("");
  const v = example("observation-detected.ci.v1.json");
  v.finding.observed = "Deploy failed using key " + secret;
  const r = await intake.submit({ principal: p, body: body(v) });
  assert.ok(r.ok);
  const [rec] = store.records();
  assert.equal(JSON.stringify(rec).includes(secret), false, "secret never stored");
  assert.equal(rec.state, "quarantined");
  assert.deepEqual(rec.screening.redactions, ["aws-access-key-id"]);
  assert.equal(rec.classification, "untriaged");
});

test("every machine failure code is catalogued with a status; unknown codes fail closed", () => {
  for (const c of MACHINE_ERROR_CODES) assert.ok(machineFailure(c).status >= 400, c);
  assert.equal(machineFailure("nope").code, "storage_unavailable");
  assert.equal(machineFailure("invalid_envelope", "$.x").path, "$.x");
  assert.equal(machineFailure("throttled", "$.x").path, undefined, "paths only on validation failures");
});

// ---- item 7 / VIT-AC-032/036: no automatic lifecycle effects ---------------------------------

test("machine events always land as untriaged private observations with verified provenance (AC-032)", async () => {
  const { intake, store } = harness({ attempts: { "DEF-0042#VA-0042-1": { principalId: "wl:praxis:agent-7" }, "DEF-0042#VA-0042-2": { principalId: "wl:praxis:agent-7" } } });
  const submissions = [
    ["label-ci", "observation-detected.ci.v1.json"],
    ["label-dokimos", "verification-failed.dokimos.v1.json"],
    ["label-dokimos", "verification-passed.dokimos.v1.json"],
    ["label-ci", "verification-inconclusive.ci.v1.json"],
    ["label-ordo", "governance-violation.ordo.v1.json"],
    ["label-tutela", "security-rule.tutela.v1.json"]
  ];
  for (const [label, file] of submissions) {
    const r = await intake.submit({ principal: await principal(label), body: body(example(file)) });
    assert.ok(r.ok, file + " " + JSON.stringify(r.error));
  }
  const records = store.records();
  assert.equal(records.length, 6);
  for (const rec of records) {
    assert.equal(rec.kind, "machine-observation");
    assert.equal(rec.classification, "untriaged");
    assert.ok(["received", "quarantined"].includes(rec.state));
    assert.ok(!FORBIDDEN_STATES.includes(rec.state));
    assert.ok(rec.visibility.startsWith("private"));
    assert.equal(rec.revision, 0);
    assert.deepEqual(rec.history, []);
    assert.ok(Object.isFrozen(rec) && Object.isFrozen(rec.envelope.finding));
  }
  const byType = Object.fromEntries(records.map(r => [r.eventType + ":" + r.principal.system, r]));
  assert.equal(byType["observation.detected:ci"].provenance, "ci");
  assert.equal(byType["governance.violation:ordo"].provenance, "application");
  assert.equal(byType["observation.detected:ci"].envelope.source.repository, "kemiller2002/summa", "original source/repo preserved");
});

test("the core never imports or calls the lifecycle engine", () => {
  const src = readFileSync(new URL("../service/machine/observation-core.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'][^"']*(lifecycle|triage)[^"']*["']/);
  assert.doesNotMatch(src, /evaluateTransition|promoteObservation|transition\(/);
});

test("independent verification.failed / passed yield only a non-executable proposal", async () => {
  const { intake, store } = harness({ attempts: { "DEF-0042#VA-0042-1": { principalId: "wl:praxis:agent-7" }, "DEF-0042#VA-0042-2": { principalId: "wl:praxis:agent-7" } } });
  const p = await principal("label-dokimos");
  await intake.submit({ principal: p, body: body(example("verification-failed.dokimos.v1.json")) });
  await intake.submit({ principal: p, body: body(example("verification-passed.dokimos.v1.json")) });
  const [failed, passed] = store.records();
  for (const rec of [failed, passed]) {
    const prop = rec.verification.proposal;
    assert.ok(prop, "independent result carries a proposal");
    assert.equal(prop.status, "proposed");
    assert.equal(prop.applied, false);
    assert.equal(prop.expectedFrom, "awaiting-verification");
    for (const executable of ["to", "actor", "role", "expectedRevision", "reason", "occurredAt"]) assert.equal(executable in prop, false, executable);
    assert.equal(prop.candidateRevision, rec.envelope.subject.commit);
    assert.equal(prop.verificationAttemptId, rec.envelope.correlation.verificationAttemptId);
    assert.equal(rec.classification, "untriaged");
    assert.equal(rec.state, "received");
  }
  assert.equal(failed.verification.proposal.suggestedTarget, "in-progress");
  assert.equal(passed.verification.proposal.suggestedTarget, "resolved");
});

test("item 7: self-certification (verifier == attempt author) is flagged and produces no proposal", async () => {
  const { intake, store } = harness({ attempts: { "DEF-0042#VA-0042-2": { principalId: "wl:dokimos:summa" } } });
  const r = await intake.submit({ principal: await principal("label-dokimos"), body: body(example("verification-passed.dokimos.v1.json")) });
  assert.ok(r.ok);
  const [rec] = store.records();
  assert.ok(rec.flags.includes("self-certification"));
  assert.equal(rec.verification.proposal, null);
  assert.equal(rec.verification.withheldReason, "self-certification");
});

test("item 7: green build without attempt context, suspected pass, unknown attempt, inconclusive -> no proposal", async () => {
  // No lookupAttempt port: independence cannot be shown, so nothing is proposed.
  const { makeMemoryStore } = await import("../service/machine/memory-store.mjs");
  const store = makeMemoryStore();
  const bare = makeMachineIntake({ store, now: () => NOW, observationId: () => "OBS-" + "a".repeat(32) });
  const ci = await principal("label-ci");
  const green = example("verification-passed.dokimos.v1.json");
  green.source.system = "ci";
  assert.ok((await bare.submit({ principal: ci, body: body(green) })).ok);
  assert.equal(store.records()[0].verification.proposal, null);
  assert.equal(store.records()[0].verification.withheldReason, "attempt-author-unknown");

  const h = harness({ attempts: { "DEF-0042#VA-0042-2": { principalId: "wl:praxis:agent-7" } } });
  const d = await principal("label-dokimos");
  const suspected = example("verification-passed.dokimos.v1.json");
  suspected.finding.confidence = "suspected";
  await h.intake.submit({ principal: d, body: body(suspected) });
  const unknown = { ...example("verification-passed.dokimos.v1.json"), eventId: v4(), correlation: { defectId: "DEF-0099", verificationAttemptId: "VA-X", causationEventId: null } };
  await h.intake.submit({ principal: d, body: body(unknown) });
  const flaky = { ...example("verification-failed.dokimos.v1.json"), eventId: v4(), finding: { ...example("verification-failed.dokimos.v1.json").finding, category: "flaky-test" } };
  await h.intake.submit({ principal: d, body: body(flaky) });
  await h.intake.submit({ principal: await principal("label-ci"), body: body(example("verification-inconclusive.ci.v1.json")) });
  const recs = h.store.records();
  assert.equal(recs.length, 4);
  assert.deepEqual(recs.map(r => r.verification.withheldReason), ["not-observed", "unknown-attempt", "infrastructure-or-flaky-category", "inconclusive-result"]);
  assert.ok(recs.every(r => r.verification.proposal === null));
  assert.ok(recs.find(r => r.eventType === "verification.inconclusive").flags.includes("inconclusive"));
});

test("item 7: malformed verification and forged passing status cannot reach storage", async () => {
  const { intake, store } = harness({ attempts: { "DEF-0042#VA-0042-2": { principalId: "wl:praxis:agent-7" } } });
  const malformed = example("verification-passed.dokimos.v1.json");
  malformed.correlation.verificationAttemptId = null;
  assert.equal((await intake.submit({ principal: await principal("label-dokimos"), body: body(malformed) })).error.code, "invalid_envelope");
  const lifecycleClaim = example("verification-passed.dokimos.v1.json");
  lifecycleClaim.finding.classification = "resolved";
  assert.equal((await intake.submit({ principal: await principal("label-dokimos"), body: body(lifecycleClaim) })).error.code, "invalid_envelope");
  // A ci-detect-only workload claims to be dokimos to send a pass.
  const forged = example("verification-passed.dokimos.v1.json");
  assert.equal((await intake.submit({ principal: await principal("label-ci-detect-only"), body: body(forged) })).error.code, "identity_mismatch");
  forged.source.system = "ci";
  assert.equal((await intake.submit({ principal: await principal("label-ci-detect-only"), body: body(forged) })).error.code, "event_type_not_in_scope");
  assert.equal(store.records().length, 0);
});

// ---- item 8: echo suppression -------------------------------------------------------------

test("item 8: Vitium-originated events (marker or vitium principal) are dropped, never stored", async () => {
  const { intake, store } = harness();
  const marked = example("observation-detected.ci.v1.json");
  marked.correlation.originMarker = "vitium/issue-sync:DEF-0042";
  const r1 = await intake.submit({ principal: await principal("label-ci"), body: body(marked) });
  assert.equal(r1.ok, true);
  assert.equal(r1.value.disposition, "echo-suppressed");
  assert.equal(r1.value.ack, undefined, "no ack: nothing to correlate further");
  const self = example("observation-detected.ci.v1.json");
  self.eventId = v4();
  self.source = { ...self.source, system: "vitium", repository: "kemiller2002/vitium" };
  const r2 = await intake.submit({ principal: await principal("label-vitium"), body: body(self) });
  assert.equal(r2.value.disposition, "echo-suppressed");
  assert.equal(store.records().length, 0);
});

test("item 8: Vitium's own CI reporting the same failure repeatedly yields one candidate, never a loop", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci-vitium-repo");
  for (let i = 0; i < 5; i++) {
    const v = withRun("observation-detected.ci.v1.json", "vitium-ci-" + i);
    v.source.repository = "kemiller2002/vitium";
    const r = await intake.submit({ principal: p, body: body(v) });
    assert.ok(r.ok);
    assert.equal(r.value.disposition, "recorded");
    // Retry of the same delivery: still one record.
    await intake.submit({ principal: p, body: body(v) });
  }
  const recs = store.records();
  assert.equal(recs.length, 5, "one occurrence per run; retries are idempotent");
  assert.equal(new Set(recs.map(r => r.candidate.fingerprint)).size, 1);
  assert.ok(recs.every(r => r.classification === "untriaged" && r.verification.proposal === null));
});

// ---- security routing ------------------------------------------------------------------

test("Tutela / security categories / vulnerability language route private-security and are never publicly projectable", async () => {
  const { intake, store } = harness();
  await intake.submit({ principal: await principal("label-tutela"), body: body(example("security-rule.tutela.v1.json")) });
  const ciSec = example("observation-detected.ci.v1.json");
  ciSec.finding.category = "security-rule";
  await intake.submit({ principal: await principal("label-ci"), body: body(ciSec) });
  const vuln = withRun("observation-detected.ci.v1.json", "pipeline-run-300");
  vuln.finding.observed = "Possible SQL injection in the search handler";
  await intake.submit({ principal: await principal("label-ci"), body: body(vuln) });
  const plain = withRun("observation-detected.ci.v1.json", "pipeline-run-301");
  await intake.submit({ principal: await principal("label-ci"), body: body(plain) });
  const recs = store.records();
  assert.equal(recs.length, 4);
  const [tutela, sec, lang, normal] = recs;
  for (const r of [tutela, sec, lang]) {
    assert.equal(r.visibility, "private-security");
    assert.equal(r.securityClassified, true);
    assert.equal(r.publicProjection, "never");
    assert.equal(mayProjectPublicly(r, { approvedBy: "maintainer-1" }).error.code, "projection_forbidden");
  }
  assert.equal(normal.visibility, "private");
  assert.equal(mayProjectPublicly(normal, undefined).error.code, "projection_requires_review");
  assert.equal(mayProjectPublicly(normal, { approvedBy: "maintainer-1" }).ok, true);
  // Tampered record claiming to be non-security but with a security flag mismatch is refused.
  assert.equal(mayProjectPublicly({ ...tutela, visibility: "private" }, { approvedBy: "m" }).error.code, "projection_forbidden");
});

test("any Tutela finding is security-classified even when its category is not security-rule", async () => {
  const { intake, store } = harness();
  const v = example("security-rule.tutela.v1.json");
  v.finding.category = "quality-rule";
  v.finding.summary = "Rule evaluation reported a policy finding";
  assert.ok((await intake.submit({ principal: await principal("label-tutela"), body: body(v) })).ok);
  const [rec] = store.records();
  assert.equal(rec.visibility, "private-security");
  assert.equal(rec.publicProjection, "never");
});

test("makeMachineIntake refuses construction without its effects", () => {
  assert.throws(() => makeMachineIntake({}), TypeError);
  assert.throws(() => makeMachineIntake({ store: { putOnce() {} }, now: () => NOW, observationId: () => "x" }), TypeError);
});
