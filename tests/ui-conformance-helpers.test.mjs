// Pure-function checks for the local Forma-API conformance helper mirror
// (tests/ui-conformance/ui-conformance-helpers.mjs). A broken evaluator could
// turn missing evidence into PASS; these cases pin the contract vocabulary of
// visual-engineering UI-LAYOUT-INTERACTION@1.0.0 (lack of evidence = UNKNOWN).
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, evaluateAlignment, validateAlignmentGroup, evaluateActionOutcome, validateActionContract
} from "./ui-conformance/ui-conformance-helpers.mjs";

const peers = [{ role: "combobox", name: "A" }, { role: "combobox", name: "B" }];
const group = { id: "row", peers };
const seen = (peer, y, height = 48) => ({ peer, count: 1, box: { x: 0, y, width: 100, height } });

test("aligned peers within 1 CSS px pass; beyond tolerance fail", () => {
  assert.equal(evaluateAlignment(group, [seen(peers[0], 10), seen(peers[1], 11)]).status, STATUS.PASS);
  const stagger = evaluateAlignment(group, [seen(peers[0], 10), seen(peers[1], 30.1)]);
  assert.equal(stagger.status, STATUS.FAIL);
  assert.ok(Math.abs(stagger.deltaCssPx - 20.1) < 1e-9);
});

test("missing, ambiguous or unrendered peers are UNKNOWN, never PASS", () => {
  for (const broken of [{ peer: peers[1], count: 0, box: null }, { peer: peers[1], count: 2, box: null }, seen(peers[1], 10, 0)]) {
    const report = evaluateAlignment(group, [seen(peers[0], 10), broken]);
    assert.equal(report.status, STATUS.UNKNOWN);
    assert.equal(report.deltaCssPx, null);
  }
});

test("a group must be declared with semantic peers and a ULI-L rule", () => {
  assert.throws(() => validateAlignmentGroup({ id: "x", peers: [peers[0]] }), /at least two/);
  assert.throws(() => validateAlignmentGroup({ id: "x", peers: [{ role: "combobox" }, peers[1]] }), /role and name/);
  assert.throws(() => validateAlignmentGroup({ ...group, ruleId: "ULI-A01" }), /ULI-L/);
});

test("an action passes only on an observed transition to the expected post-state", () => {
  const contract = validateActionContract({
    action: { role: "button", name: "Review my report" },
    outcome: { kind: "visible", target: { role: "heading", name: "Does this look right?" }, expected: true }
  });
  const pre = { value: false, missing: true, count: 0 };
  assert.equal(evaluateActionOutcome({ ...contract, pre, post: { value: true } }).status, STATUS.PASS);
  assert.equal(evaluateActionOutcome({ ...contract, pre, post: { value: false } }).status, STATUS.FAIL);
  assert.equal(evaluateActionOutcome({ ...contract, pre: { value: true, count: 1 }, post: { value: true } }).status, STATUS.FAIL,
    "a pre-existing post-state cannot prove the action did anything");
  assert.equal(evaluateActionOutcome({ ...contract, pre, post: null, controlIssue: "action control is disabled" }).status, STATUS.UNKNOWN);
});
