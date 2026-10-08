// Adversarial attacks on service/triage.mjs against the documented candidate model
// in docs/requirements/VITIUM-OPEN-DECISIONS.md ("Proposed lifecycle semantics").
// VIT-LCY-001/002/003/004, VIT-AC-011/012.
import test from "node:test";
import assert from "node:assert/strict";
import { transition, observationStates, defectStates } from "../../service/triage.mjs";
import { attempt, readRepo } from "../verification/contracts.mjs";

const ts = "2026-10-08T12:00:00.000Z";
const tryTransition = attempt(transition);
const cmd = (to, o = {}) => ({ to, actor: "operator-1", role: "triager", reason: "Investigated", expectedRevision: 0, occurredAt: ts, ...o });
const rec = (kind, state, o = {}) => ({ kind, state, revision: 0, history: [], ...o });

// Pure: parse the candidate edges from the documented diagram (authoritative text).
// Edges written in docs/requirements/VITIUM-OPEN-DECISIONS.md, transcribed exactly:
const DOCUMENTED = Object.freeze({
  observation: {
    received: ["quarantined"], quarantined: ["accepted-for-triage", "rejected"],
    "accepted-for-triage": ["classified"], classified: [], rejected: []
  },
  defect: {
    new: ["triaged"], triaged: ["reproducing", "duplicate", "not-reproducible"],
    reproducing: ["confirmed"], confirmed: ["in-progress"], "in-progress": ["awaiting-verification"],
    "awaiting-verification": ["in-progress", "resolved"], resolved: ["closed", "reopened"],
    closed: ["reopened"], duplicate: [], "not-reproducible": [], reopened: []
  }
});

test("VIT-LCY-001: documented model text is still the one transcribed here (guards against silent doc drift)", () => {
  const doc = readRepo("docs/requirements/VITIUM-OPEN-DECISIONS.md");
  for (const fragment of ["received -> quarantined/review -> accepted-for-triage -> classified", "new -> triaged -> reproducing -> confirmed -> in-progress", "resolved/closed -> reopened"]) {
    assert.ok(doc.includes(fragment), fragment);
  }
});

const legalOptions = (kind, from, to) => {
  const o = { classification: "suspected defect", evidenceId: "ev-1" };
  return to === "resolved" ? { ...o, role: "verifier" } : o;
};

test("VIT-LCY-001: every documented edge is executable by an authorised actor", () => {
  for (const [kind, graph] of Object.entries(DOCUMENTED)) {
    for (const [from, tos] of Object.entries(graph)) {
      for (const to of tos) {
        const r = tryTransition(rec(kind, from), cmd(to, legalOptions(kind, from, to)));
        assert.ok(r.ok, `${kind}: ${from} -> ${to} refused: ${r.error?.message}`);
      }
    }
  }
});

test("VIT-LCY-001 / VIT-AC-012: transitions not in the documented candidate model are refused", { todo: "finding VF-014" }, () => {
  const extra = [];
  for (const [kind, graph] of Object.entries(DOCUMENTED)) {
    const states = kind === "observation" ? observationStates : defectStates;
    for (const from of states) {
      for (const to of states) {
        if ((graph[from] ?? []).includes(to)) continue;
        if (tryTransition(rec(kind, from), cmd(to, legalOptions(kind, from, to))).ok) extra.push(`${kind}:${from}->${to}`);
      }
    }
  }
  assert.deepEqual(extra, [], "undocumented edges are executable");
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

test("VIT-LCY-004 / VIT-AC-012: closing as duplicate requires a reference to the canonical record", { todo: "finding VF-015" }, () => {
  const r = tryTransition(rec("defect", "triaged"), cmd("duplicate", { reason: "dup" }));
  assert.equal(r.ok, false, "duplicate accepted with no duplicateOf/evidence reference");
});

test("VIT-LCY-004: resolved -> closed requires evidence of the verified resolution (policy guard)", { todo: "finding VF-015" }, () => {
  const r = tryTransition(rec("defect", "resolved"), cmd("closed", { reason: "done" }));
  assert.equal(r.ok, false, "closed with no evidence or policy reference");
});

test("VIT-LCY-004: evidenceId must be a non-empty string, not any truthy value", { todo: "finding VF-015" }, () => {
  for (const evidenceId of [{}, [], 1, true, "   "]) {
    const r = tryTransition(rec("defect", "triaged"), cmd("confirmed", { evidenceId }));
    assert.equal(r.ok, false, JSON.stringify(evidenceId));
  }
});

test("VIT-LCY-004 / VIT-AC-012: reopening preserves the closure event and the prior history unchanged", () => {
  let r = rec("defect", "awaiting-verification");
  r = transition(r, cmd("resolved", { role: "verifier", evidenceId: "verify-1" }));
  r = transition(r, cmd("closed", { expectedRevision: 1, reason: "Verified in release" }));
  const closedHistory = r.history;
  const reopened = transition(r, cmd("reopened", { expectedRevision: 2, reason: "Regression observed" }));
  assert.equal(reopened.history.length, 3);
  assert.deepEqual(reopened.history.slice(0, 2), closedHistory);
  assert.equal(reopened.history[1].to, "closed");
  assert.equal(reopened.history[0].evidenceId, "verify-1");
  assert.ok(Object.isFrozen(reopened.history) && Object.isFrozen(reopened.history[2]));
  assert.throws(() => { reopened.history.push({}); });
  assert.equal(r.history.length, 2, "input record is not mutated");
});

test("VIT-LCY-004 / VIT-DOM-007: a caller cannot erase history by supplying a record with a truncated history", { todo: "finding VF-016" }, () => {
  // revision 2 says two events happened; history claims none. The guard must refuse.
  const forged = rec("defect", "closed", { revision: 2, history: [] });
  const r = tryTransition(forged, cmd("reopened", { expectedRevision: 2, reason: "reopen" }));
  assert.equal(r.ok, false, "accepted a record whose history length != revision");
});

test("VIT-LCY-004: a caller cannot rewrite past events by supplying a mutable history array", { todo: "finding VF-016" }, () => {
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

test("VIT-DOM-007: occurredAt must be a real ISO-8601 instant, not just a prefix match", { todo: "finding VF-017" }, () => {
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
