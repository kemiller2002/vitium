// Adversarial attacks on service/triage.mjs (VIT-LCY-001/002/003/004, VIT-AC-011/012).
//
// Edge authority: schemas/lifecycle/transitions.v1.json, the single machine-readable
// candidate table recorded in docs/decisions/DOM-001-lifecycle-and-identities.md
// (decision 1). It superseded the prose diagram in VITIUM-OPEN-DECISIONS.md in fix round 1
// (see docs/verification/EVIDENCE-APPRAISAL.md, "Fix round 1 adjudication"). The table is
// read HERE, independently of the service's loader, so a loader that silently drops or
// adds edges is still caught.
import test from "node:test";
import assert from "node:assert/strict";
import { transition, observationStates, defectStates } from "../../service/triage.mjs";
import { attempt, readRepo, readJson } from "../verification/contracts.mjs";

const ts = "2026-10-08T12:00:00.000Z";
const tryTransition = attempt(transition);
const cmd = (to, o = {}) => ({ to, actor: "operator-1", role: "triager", reason: "Investigated", expectedRevision: 0, occurredAt: ts, ...o });
const rec = (kind, state, o = {}) => ({ kind, state, revision: 0, history: [], ...o });

const TABLE = readJson("schemas/lifecycle/transitions.v1.json");
const ruleFor = (kind, from, to) => TABLE.machines[kind].transitions.find(t => t.from === from && t.to === to);
const VALID_FIELD = Object.freeze({ duplicateOf: "DEF-0099", supersededBy: "DEF-0098", classification: "suspected defect" });

/** Pure: the minimal command options that satisfy a table rule's obligations. */
const legalOptions = (kind, from, to) => {
  const rule = ruleFor(kind, from, to);
  const fields = Object.fromEntries(rule.requiredFields.map(f => [f, VALID_FIELD[f] ?? "value"]));
  const evidence = rule.evidenceAnyOf.length ? { evidence: [{ kind: rule.evidenceAnyOf[0], ref: "ev-" + to }] } : {};
  const role = rule.roles.includes("triager") ? "triager" : rule.roles[0];
  return { ...fields, ...evidence, role };
};
/** Pure: the most permissive options imaginable (admin, every evidence kind, every field). */
const maximalOptions = () => ({
  role: "administrator", ...VALID_FIELD,
  evidence: Object.keys(TABLE.evidenceKinds).map(kind => ({ kind, ref: "ev-" + kind }))
});

test("VIT-LCY-001: the edge authority is the DOM-001 candidate table and does not claim Ordo authority", () => {
  assert.equal(TABLE.authority, "vitium-domain-candidate");
  assert.equal(TABLE.ordoAuthorized, false);
  assert.match(readRepo("docs/decisions/DOM-001-lifecycle-and-identities.md"), /schemas\/lifecycle\/transitions\.v1\.json/);
  assert.deepEqual([...observationStates], TABLE.machines.observation.states);
  assert.deepEqual([...defectStates], TABLE.machines.defect.states);
});

test("VIT-LCY-001: every table edge is executable by an authorised actor that meets its obligations", () => {
  for (const [kind, machine] of Object.entries(TABLE.machines)) {
    for (const { from, to } of machine.transitions) {
      const r = tryTransition(rec(kind, from), cmd(to, legalOptions(kind, from, to)));
      assert.ok(r.ok, `${kind}: ${from} -> ${to} refused: ${r.error?.code} ${r.error?.message}`);
    }
  }
});

test("VIT-LCY-001: every table obligation is enforced (missing evidence / field / role is refused)", () => {
  for (const [kind, machine] of Object.entries(TABLE.machines)) {
    for (const rule of machine.transitions) {
      const ok = legalOptions(kind, rule.from, rule.to);
      if (rule.evidenceAnyOf.length) {
        const { evidence, ...noEvidence } = ok;
        assert.equal(tryTransition(rec(kind, rule.from), cmd(rule.to, noEvidence)).ok, false, `${rule.from}->${rule.to} without evidence`);
        assert.equal(tryTransition(rec(kind, rule.from), cmd(rule.to, { ...noEvidence, evidence: [{ kind: "unspecified", ref: "x" }] })).ok, false, `${rule.from}->${rule.to} with unspecified evidence`);
      }
      for (const field of rule.requiredFields) {
        const { [field]: _omitted, ...without } = ok;
        assert.equal(tryTransition(rec(kind, rule.from), cmd(rule.to, without)).ok, false, `${rule.from}->${rule.to} without ${field}`);
      }
      for (const role of TABLE.roles.filter(r => !rule.roles.includes(r))) {
        assert.equal(tryTransition(rec(kind, rule.from), cmd(rule.to, { ...ok, role })).ok, false, `${rule.from}->${rule.to} as ${role}`);
      }
    }
  }
});

test("VIT-LCY-001 / VIT-AC-012: pairs absent from the table are refused even with maximal authority and evidence (VF-014)", () => {
  const extra = [];
  for (const [kind, machine] of Object.entries(TABLE.machines)) {
    for (const from of machine.states) {
      for (const to of machine.states) {
        if (ruleFor(kind, from, to)) continue;
        if (tryTransition(rec(kind, from), cmd(to, maximalOptions())).ok) extra.push(`${kind}:${from}->${to}`);
      }
    }
  }
  assert.deepEqual(extra, [], "edges executable that the authority table does not contain");
});

test("VIT-LCY-001 / VIT-AC-012: same-kind skips and terminal escapes are refused (fail closed)", () => {
  const illegal = [
    ["defect", "new", "resolved"], ["defect", "new", "closed"], ["defect", "new", "confirmed"],
    ["defect", "triaged", "in-progress"], ["defect", "confirmed", "resolved"], ["defect", "in-progress", "closed"],
    ["defect", "closed", "in-progress"], ["defect", "closed", "resolved"], ["defect", "duplicate", "closed"],
    ["defect", "reopened", "resolved"], ["observation", "rejected", "accepted-for-triage"],
    ["observation", "classified", "received"], ["observation", "received", "classified"]
  ];
  for (const [kind, from, to] of illegal) {
    const r = tryTransition(rec(kind, from), cmd(to, { role: "administrator", evidenceId: "ev", classification: "c" }));
    assert.equal(r.ok, false, `${kind}: ${from} -> ${to} was allowed`);
    assert.match(r.error.message, /not permitted/);
  }
});

test("VIT-LCY-002 / VIT-AC-011: no transition crosses observation -> defect, from any state", () => {
  for (const from of observationStates) {
    for (const to of defectStates) {
      assert.equal(tryTransition(rec("observation", from), cmd(to, { evidenceId: "e", classification: "c", role: "administrator" })).ok, false, `${from}->${to}`);
    }
  }
});

test("VIT-LCY-003 / VIT-AC-011: unauthorised roles and blank actors are refused for every edge", () => {
  for (const role of ["reporter", "anonymous", "Triager", "", undefined, "admin"]) {
    assert.equal(tryTransition(rec("defect", "new"), cmd("triaged", { role })).ok, false, String(role));
  }
  for (const actor of ["", "   ", undefined, 42]) {
    assert.equal(tryTransition(rec("defect", "new"), cmd("triaged", { actor })).ok, false, String(actor));
  }
});

test("VIT-LCY-004 / VIT-AC-012: closure dispositions require an explicit reason", () => {
  for (const [from, to] of [["triaged", "duplicate"], ["triaged", "not-reproducible"], ["resolved", "closed"], ["received", "rejected"]]) {
    const kind = observationStates.includes(from) ? "observation" : "defect";
    for (const reason of ["", "   ", undefined, null, 7]) {
      assert.equal(tryTransition(rec(kind, from), cmd(to, { reason })).ok, false, `${from}->${to} reason=${JSON.stringify(reason)}`);
    }
  }
});

test("VIT-LCY-004 / VIT-AC-012: closing as duplicate requires a reference to the canonical record", () => {
  const r = tryTransition(rec("defect", "triaged"), cmd("duplicate", { reason: "dup" }));
  assert.equal(r.ok, false, "duplicate accepted with no duplicateOf/evidence reference");
  for (const duplicateOf of ["", "   ", "VIT-0001", "DEF-1", "OBS-" + "a".repeat(32)]) {
    assert.equal(tryTransition(rec("defect", "triaged"), cmd("duplicate", { reason: "dup", duplicateOf })).ok, false, "duplicateOf=" + duplicateOf);
  }
  assert.equal(tryTransition(rec("defect", "triaged", { id: "DEF-0007" }), cmd("duplicate", { reason: "dup", duplicateOf: "DEF-0007" })).ok, false, "self-duplicate");
  assert.equal(tryTransition(rec("defect", "triaged"), cmd("duplicate", { reason: "dup", duplicateOf: "DEF-0099" })).ok, true, "control: valid canonical reference");
});

test("VIT-LCY-004: resolved -> closed requires evidence of the verified resolution (policy guard)", () => {
  const r = tryTransition(rec("defect", "resolved"), cmd("closed", { reason: "done" }));
  assert.equal(r.ok, false, "closed with no evidence or policy reference");
});

test("VIT-LCY-004: evidenceId must be a non-empty string, not any truthy value", () => {
  for (const evidenceId of [{}, [], 1, true, "   "]) {
    const r = tryTransition(rec("defect", "triaged"), cmd("confirmed", { evidenceId }));
    assert.equal(r.ok, false, JSON.stringify(evidenceId));
  }
  assert.equal(tryTransition(rec("defect", "triaged"), cmd("confirmed", { evidenceId: "repro-1" })).ok, true, "control: a real reference is accepted");
});

test("VIT-LCY-004 / VIT-AC-012: reopening preserves the closure event and the prior history unchanged", () => {
  let r = rec("defect", "awaiting-verification");
  r = transition(r, cmd("resolved", { role: "verifier", evidence: [{ kind: "verification-run", ref: "verify-1" }] }));
  // Close with whatever evidence the authority table demands for resolved -> closed (none on
  // p0/integration; verification-run|decision-record once the VF-015 fix lands).
  const closeRule = ruleFor("defect", "resolved", "closed");
  const closeEvidence = closeRule.evidenceAnyOf.length ? { evidence: [{ kind: closeRule.evidenceAnyOf[0], ref: "close-1" }] } : {};
  r = transition(r, cmd("closed", { expectedRevision: 1, reason: "Verified in release", ...closeEvidence }));
  const closedHistory = r.history;
  const closedSnapshot = JSON.stringify(closedHistory);
  // DOM-001 decision 4: a reason alone no longer reopens; new-occurrence or triage-correction evidence is required.
  assert.equal(tryTransition(r, cmd("reopened", { expectedRevision: 2, reason: "Regression observed" })).ok, false, "reopen without new evidence");
  assert.equal(tryTransition(r, cmd("reopened", { expectedRevision: 2, reason: "Regression observed", evidence: [{ kind: "supporting", ref: "x" }] })).ok, false, "reopen with non-qualifying evidence");
  const reopened = transition(r, cmd("reopened", { expectedRevision: 2, reason: "Regression observed", evidence: [{ kind: "new-occurrence", ref: "occ-1" }] }));
  assert.equal(reopened.state, "reopened");
  assert.equal(reopened.history.length, 3);
  assert.deepEqual(reopened.history.slice(0, 2), closedHistory, "prior events unchanged");
  assert.equal(JSON.stringify(reopened.history.slice(0, 2)), closedSnapshot, "prior events byte-identical");
  assert.equal(reopened.history[1].to, "closed", "closure event retained");
  assert.deepEqual(reopened.history[0].evidence, [{ kind: "verification-run", ref: "verify-1" }], "resolution evidence retained");
  assert.equal(reopened.history[2].reopens?.sequence, 2, "reopen event points at the closure it overrides");
  assert.equal(reopened.history[2].reopens?.state, "closed");
  assert.ok(Object.isFrozen(reopened.history) && Object.isFrozen(reopened.history[2]));
  assert.throws(() => { reopened.history.push({}); });
  assert.equal(r.history.length, 2, "input record is not mutated");
  assert.equal(JSON.stringify(r.history), closedSnapshot);
});

test("VIT-LCY-004 / VIT-DOM-007: a caller cannot erase history by supplying a record with a truncated history", () => {
  // revision 2 says two events happened; history claims none. The guard must refuse.
  // The command carries the evidence DOM-001 requires for reopening, so the ONLY valid
  // reason to refuse is the forged history (fix round 1: without evidence this test
  // passed vacuously on missing_evidence).
  const forged = rec("defect", "closed", { revision: 2, history: [] });
  const evidence = [{ kind: "new-occurrence", ref: "occ-1" }];
  const r = tryTransition(forged, cmd("reopened", { expectedRevision: 2, reason: "reopen", evidence }));
  assert.equal(r.ok, false, "accepted a record whose history length != revision");
});

test("VIT-LCY-004: a caller cannot rewrite past events by supplying a mutable history array", () => {
  const history = [{ from: "new", to: "triaged", sequence: 1 }];
  const out = transition(rec("defect", "triaged", { revision: 1, history }), cmd("reproducing", { expectedRevision: 1 }));
  history[0].to = "tampered";
  assert.equal(out.history[0].to, "triaged", "history event aliased to caller-owned object");
});

test("VIT-LCY-005 precursor: stale revision is refused for every edge", () => {
  assert.equal(tryTransition(rec("defect", "new", { revision: 3, history: [{}, {}, {}] }), cmd("triaged", { expectedRevision: 2 })).ok, false);
  assert.equal(tryTransition(rec("defect", "new", { revision: -1 }), cmd("triaged", { expectedRevision: -1 })).ok, false);
  assert.equal(tryTransition(rec("defect", "new", { revision: 1.5 }), cmd("triaged", { expectedRevision: 1.5 })).ok, false);
});

test("VIT-DOM-007: occurredAt must be a real ISO-8601 instant, not just a prefix match", () => {
  for (const occurredAt of ["2026-99-99T99:99:99", "2026-10-08T12:00:00 then anything", "2026-02-30T00:00:00Z"]) {
    assert.equal(tryTransition(rec("defect", "new"), cmd("triaged", { occurredAt })).ok, false, occurredAt);
  }
});

test("VIT-AC-012: unknown source state and unknown kind fail closed", () => {
  assert.equal(tryTransition(rec("defect", "deleted"), cmd("reopened")).ok, false);
  assert.equal(tryTransition(rec("workitem", "new"), cmd("triaged")).ok, false);
  assert.equal(tryTransition(rec("defect", "__proto__"), cmd("triaged")).ok, false);
  assert.equal(tryTransition(rec("defect", "constructor"), cmd("triaged")).ok, false);
});
