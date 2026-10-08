// Cross-language lifecycle contract (VIT-LCY-001, VIT-AC-011, VIT-AC-012).
// The same transitions.v1.json drives service/triage.mjs and the F# core; the same
// transition-cases.v1.json is replayed by domain/Vitium.Domain.Tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { table, tryTransition, transition, promote, fact, permittedTargets } from "../service/triage.mjs";
import { loadTable, evaluateTransition } from "../service/lifecycle.mjs";

const readJson = path => JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));
const rawTable = readJson("schemas/lifecycle/transitions.v1.json");
const shared = readJson("schemas/lifecycle/transition-cases.v1.json");
const ts = "2026-10-08T12:00:00.000Z";
const allStates = [...table.machines.observation.states, ...table.machines.defect.states];
const strict = (o = {}) => ({ expectedRevision: 0, actor: "operator-1", provenance: "authenticated-human", role: "triager", reason: "Investigated", occurredAt: ts, ...o });
// A prior history consistent with a revision (VF-016: history length must equal revision).
const past = n => Array.from({ length: n }, (_, i) => ({ type: "transition", sequence: i + 1 }));
const fieldValue = { classification: "suspected defect", duplicateOf: "DEF-0001", supersededBy: "DEF-0003", workItemRef: "work-1" };

test("table declares candidate authority and never claims Ordo authorization", () => {
  assert.equal(rawTable.authority, "vitium-domain-candidate");
  assert.equal(rawTable.ordoAuthorized, false);
  assert.equal(loadTable({ ...rawTable, ordoAuthorized: true }).ok, false);
  assert.equal(loadTable({ ...rawTable, authority: "ordo" }).ok, false);
});

test("table integrity checks fail closed on a corrupted table", () => {
  const clone = () => structuredClone(rawTable);
  const dupPair = clone(); dupPair.machines.defect.transitions.push(dupPair.machines.defect.transitions[0]);
  assert.match(loadTable(dupPair).error.message, /Duplicate transition/);
  const badState = clone(); badState.machines.defect.transitions[0].to = "fixed";
  assert.match(loadTable(badState).error.message, /unknown state/);
  const badRole = clone(); badRole.machines.defect.transitions[0].roles = ["reporter"];
  assert.match(loadTable(badRole).error.message, /unknown roles/);
  const noReason = clone(); noReason.machines.observation.transitions[0].reasonRequired = false;
  assert.match(loadTable(noReason).error.message, /requires a reason/);
  const shared = clone(); shared.machines.defect.states.push("received");
  assert.match(loadTable(shared).error.message, /more than one machine/);
  const untyped = clone(); untyped.machines.defect.transitions[0].evidenceAnyOf = ["unspecified"];
  assert.match(loadTable(untyped).error.message, /invalid evidence kinds/);
});

// Build the most permissive well-formed command for a pair: an allowed role (or
// administrator), every required field and one item of every required evidence kind.
// If such a command is refused, only the transition graph can be the reason.
function maximalCommand(kind, from, to) {
  const rule = table.machines[kind]?.transitions.find(t => t.from === from && t.to === to);
  return strict({
    to,
    role: rule ? rule.roles[0] : "administrator",
    fields: rule ? Object.fromEntries(rule.requiredFields.map(f => [f, fieldValue[f]])) : {},
    evidence: Object.keys(table.evidenceKinds).filter(k => k !== "unspecified").map(kind => ({ kind, ref: "ev-" + kind }))
  });
}

test("exhaustive matrix: triage.mjs accepts exactly the legal (from,to) pairs and rejects every other", () => {
  let legal = 0, refused = 0;
  for (const kind of ["observation", "defect"]) {
    const legalPairs = new Set(table.machines[kind].transitions.map(t => t.from + "->" + t.to));
    for (const from of table.machines[kind].states) {
      for (const to of [...allStates, "unknown-target", ""]) {
        const result = tryTransition({ kind, id: "DEF-0002", state: from, revision: 0, history: [] }, maximalCommand(kind, from, to));
        if (legalPairs.has(from + "->" + to)) {
          assert.equal(result.ok, true, kind + " " + from + "->" + to + " should be legal: " + JSON.stringify(result.error));
          assert.equal(result.value.record.state, to);
          assert.equal(result.value.record.kind, kind, "kind never changes");
          legal++;
        } else {
          assert.equal(result.ok, false, kind + " " + from + "->" + to + " must be refused");
          assert.equal(result.error.code, "forbidden_transition", kind + " " + from + "->" + to);
          refused++;
        }
      }
    }
  }
  assert.equal(legal, table.machines.observation.transitions.length + table.machines.defect.transitions.length);
  assert.equal(legal, 40);
  assert.ok(refused > 250, "matrix covered " + refused + " refusals");
});

test("shared transition cases (also run by the F# runner) pass in JS", () => {
  assert.equal(shared.table, "schemas/lifecycle/transitions.v1.json");
  assert.ok(shared.cases.length >= 40);
  for (const c of shared.cases) {
    const result = evaluateTransition(table, c.record, c.command);
    if (c.expect.ok) {
      assert.equal(result.ok, true, c.name + ": " + JSON.stringify(result.error));
      assert.equal(result.value.record.state, c.expect.state, c.name);
      assert.equal(result.value.record.revision, c.expect.revision, c.name);
      assert.equal(result.value.record.history.length, c.record.history.length + 1, c.name);
    } else {
      assert.equal(result.ok, false, c.name + " should fail");
      assert.equal(result.error.code, c.expect.code, c.name);
    }
  }
});

test("VIT-AC-011: unverified report stays an observation; triage judgements are independent and recorded", () => {
  const received = { kind: "observation", observationId: "OBS-" + "a".repeat(32), state: "received", revision: 0, history: [] };
  const accepted = transition(received, strict({ to: "accepted-for-triage" }));
  const classified = tryTransition(accepted, strict({ to: "classified", expectedRevision: 1, fields: { classification: "suspected defect", severity: "low", priority: "urgent", owner: "team-forma" } }));
  assert.equal(classified.ok, true);
  const rec = classified.value.record;
  assert.equal(rec.kind, "observation");
  // Severity and priority are what the triager chose, not derived from each other.
  assert.deepEqual(rec.triage, { classification: "suspected defect", severity: "low", priority: "urgent", owner: "team-forma" });
  assert.equal(rec.triage.confidence, undefined, "confidence is not inferred");
  assert.deepEqual(permittedTargets(table, "observation", "accepted-for-triage", "triager").sort(), ["classified", "quarantined", "rejected"]);
  assert.deepEqual(permittedTargets(table, "observation", "classified", "administrator"), []);
});

test("VIT-LCY-002: promotion creates a new defect identity and never mutates the observation into a defect", () => {
  const obs = { kind: "observation", observationId: "OBS-" + "b".repeat(32), state: "classified", revision: 2, history: [{ sequence: 1 }, { sequence: 2 }] };
  const cmd = strict({ expectedRevision: 2, defectId: "DEF-0042", reason: "Reproducible pattern" });
  const result = promote(obs, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.value.observation.kind, "observation");
  assert.equal(result.value.observation.state, "classified");
  assert.equal(result.value.observation.observationId, obs.observationId);
  assert.deepEqual(result.value.observation.links.defectIds, ["DEF-0042"]);
  assert.equal(result.value.observation.history.length, 3);
  assert.equal(result.value.defect.kind, "defect");
  assert.equal(result.value.defect.id, "DEF-0042");
  assert.equal(result.value.defect.state, "new");
  assert.deepEqual(result.value.defect.observationIds, [obs.observationId]);
  assert.equal(obs.history.length, 2, "input untouched");
  // Guards
  assert.equal(promote({ ...obs, state: "accepted-for-triage" }, cmd).error.code, "forbidden_transition");
  assert.equal(promote(obs, { ...cmd, role: "verifier" }).error.code, "unauthorized_role");
  assert.equal(promote(obs, { ...cmd, expectedRevision: 1 }).error.code, "stale_revision");
  assert.equal(promote(obs, { ...cmd, defectId: obs.observationId }).error.code, "invalid_defect_id");
  assert.equal(promote(obs, { ...cmd, reason: "" }).error.code, "missing_reason");
  assert.equal(promote({ ...obs, kind: "defect" }, cmd).error.code, "unknown_machine");
  assert.equal(promote(result.value.observation, { ...cmd, expectedRevision: 3 }).error.code, "invalid_defect_id", "same defect cannot be linked twice");
  // There is no transition into a defect state from an observation via transition().
  assert.equal(tryTransition(obs, strict({ to: "new", expectedRevision: 2 })).error.code, "forbidden_transition");
});

test("VIT-AC-012: close as duplicate, then reopen preserves closure evidence and history", () => {
  let rec = { kind: "defect", id: "DEF-0007", state: "triaged", revision: 0, history: [] };
  const dup = tryTransition(rec, strict({ to: "duplicate", fields: { duplicateOf: "DEF-0001" }, evidence: [{ kind: "supporting", ref: "fingerprint-match" }] }));
  assert.equal(dup.ok, true);
  rec = dup.value.record;
  assert.equal(rec.history[0].fields.duplicateOf, "DEF-0001");
  assert.equal(rec.triage, undefined, "duplicateOf is a relationship, not a triage judgement");
  const noEvidence = tryTransition(rec, strict({ to: "reopened", expectedRevision: 1 }));
  assert.equal(noEvidence.error.code, "missing_evidence");
  const reopened = tryTransition(rec, strict({ to: "reopened", expectedRevision: 1, reason: "Different root cause", evidence: [{ kind: "triage-correction", ref: "analysis-3" }] }));
  assert.equal(reopened.ok, true);
  const h = reopened.value.record.history;
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], rec.history[0], "prior closure event is retained verbatim");
  assert.deepEqual(h[1].reopens, { sequence: 1, state: "duplicate", evidence: [{ kind: "supporting", ref: "fingerprint-match" }] });
  assert.ok(Object.isFrozen(h[0]) && Object.isFrozen(h));
});

test("reopen after verified resolution links back to the verification evidence", () => {
  let rec = { kind: "defect", id: "DEF-0009", state: "awaiting-verification", revision: 4, history: past(4) };
  rec = tryTransition(rec, strict({ to: "resolved", role: "verifier", expectedRevision: 4, evidence: [{ kind: "verification-run", ref: "run-1" }] })).value.record;
  rec = tryTransition(rec, strict({ to: "closed", expectedRevision: 5, evidence: [{ kind: "verification-run", ref: "run-1" }] })).value.record;
  const r = tryTransition(rec, strict({ to: "reopened", expectedRevision: 6, evidence: [{ kind: "new-occurrence", ref: "occ-2" }] }));
  assert.equal(r.ok, true);
  // 'closed' carries no evidence of its own; reopens points at the latest disposition event.
  assert.equal(r.value.event.reopens.state, "closed");
  assert.equal(r.value.record.history[4].evidence[0].ref, "run-1");
});

test("fix facts are events, not states (VIT-VER-005 groundwork)", () => {
  const rec = { kind: "defect", id: "DEF-0010", state: "in-progress", revision: 3, history: past(3) };
  const merged = fact(rec, strict({ fact: "code-merged", expectedRevision: 3, evidence: [{ kind: "supporting", ref: "commit-abc" }] }));
  assert.equal(merged.ok, true);
  assert.equal(merged.value.record.state, "in-progress", "a fact never changes state");
  assert.equal(merged.value.record.revision, 4);
  assert.equal(fact(rec, strict({ fact: "verified-resolved", expectedRevision: 3, evidence: [{ kind: "verification-run", ref: "r" }] })).error.code, "unauthorized_role");
  assert.equal(fact(rec, strict({ fact: "deployed", expectedRevision: 3 })).error.code, "unknown_fact");
  assert.equal(fact(rec, strict({ fact: "code-merged", expectedRevision: 2, evidence: [{ kind: "supporting", ref: "c" }] })).error.code, "stale_revision");
  assert.equal(fact({ ...rec, kind: "observation" }, strict({ fact: "code-merged", expectedRevision: 3 })).error.code, "unknown_machine");
  assert.ok(!table.machines.defect.states.some(s => /merged|deployed|built/.test(s)));
});

test("legacy command shape (service/triage-cli.mjs) still works and records unrecorded provenance", () => {
  const legacy = { to: "accepted-for-triage", expectedRevision: 0, actor: "arn:aws:iam::123456789012:user/operator", role: "triager", reason: "Looks genuine", occurredAt: ts, classification: undefined, evidenceId: undefined };
  const next = transition({ kind: "observation", state: "received", revision: 0, history: [] }, legacy);
  assert.equal(next.history[0].provenance, "unrecorded");
  assert.equal(next.history[0].actor, legacy.actor);
  // Strict API refuses an unrecorded provenance.
  assert.equal(evaluateTransition(table, { kind: "observation", state: "received", revision: 0 }, { ...legacy, provenance: "unrecorded" }).error.code, "invalid_provenance");
});
