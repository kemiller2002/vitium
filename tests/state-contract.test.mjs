import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {defectStates, observationStates, transition} from "../service/triage.mjs";

const read = path => JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

test("versioned defect schema admits every candidate lifecycle state including reopened", () => {
  const states = read("schemas/defect.schema.json").properties.state.enum;
  assert.deepEqual([...states].sort(), [...defectStates].sort());
  assert.ok(states.includes("in-progress"));
  assert.ok(states.includes("reopened"));
});

test("classified observation is not confused with confirmed defect", () => {
  const states = read("schemas/observation.schema.json").properties.state.enum;
  assert.deepEqual([...states].sort(), [...observationStates].sort());
});

test("failed verification preserves an auditable event and does not imply resolved", () => {
  const initial = {kind:"defect",state:"awaiting-verification",revision:1,history:[{
    to:"awaiting-verification",attemptId:"attempt-1",candidateRevision:"abc123",sequence:1
  }]};
  const result = transition(initial,{
    to:"in-progress",actor:"reviewer-2",role:"verifier",
    reason:"Regression test failed",verificationOutcome:"failed",
    evidenceId:"run-456",attemptId:"attempt-1",candidateRevision:"abc123",
    expectedRevision:1,occurredAt:"2026-10-08T12:00:00.000Z"
  });
  assert.equal(result.state,"in-progress");
  assert.equal(result.revision,2);
  assert.equal(result.history[1].verificationOutcome,"failed");
  assert.equal(result.history[1].evidenceId,"run-456");
  assert.equal(initial.state,"awaiting-verification");
});
