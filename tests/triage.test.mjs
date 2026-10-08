import test from "node:test";
import assert from "node:assert/strict";
import {transition,TransitionError} from "../service/triage.mjs";
const ts="2026-10-08T12:00:00.000Z";
const cmd=(to,overrides={})=>({to,actor:"operator-1",role:"triager",reason:"Independent investigation",expectedRevision:0,occurredAt:ts,...overrides});
const caseOf=(kind,state)=>({kind,state,revision:0,history:[]});
test("an observation needs classification, not automatic defect promotion",()=>{
  const a=transition(caseOf("observation","received"),cmd("accepted-for-triage"));
  const b=transition(a,cmd("classified",{expectedRevision:1,classification:"suspected defect"}));
  assert.equal(b.kind,"observation");
  assert.equal(b.state,"classified");
  assert.equal(b.history.length,2);
  assert.deepEqual(b.history.map(x=>x.sequence),[1,2]);
  assert.throws(()=>transition(caseOf("observation","received"),cmd("confirmed")),TransitionError);
});
test("authorization, stale writes and missing rationale fail closed",()=>{
  assert.throws(()=>transition(caseOf("defect","new"),cmd("triaged",{role:"reporter"})),/not authorized/);
  assert.throws(()=>transition(caseOf("defect","new"),cmd("triaged",{expectedRevision:2})),/Stale/);
  assert.throws(()=>transition(caseOf("defect","new"),cmd("triaged",{reason:""})),/reason/);
});
test("defect must be independently verified to reach resolution",()=>{
  const prior=caseOf("defect","awaiting-verification");
  assert.throws(()=>transition(prior,cmd("resolved",{evidenceId:"test-123"})),/Independent verification/);
  assert.throws(()=>transition(prior,cmd("resolved",{role:"verifier"})),/Independent verification/);
  const ok=transition(prior,cmd("resolved",{role:"verifier",evidenceId:"test-123"}));
  assert.equal(ok.state,"resolved");
  assert.equal(ok.history[0].evidenceId,"test-123");
  assert.equal(prior.state,"awaiting-verification");
});
test("reproduction and closure dispositions require evidence and retain history",()=>{
  assert.throws(()=>transition(caseOf("defect","triaged"),cmd("confirmed")),/Reproduction/);
  const verified=transition(caseOf("defect","triaged"),cmd("confirmed",{evidenceId:"repro-1"}));
  assert.equal(verified.history.length,1);
  const reopened=transition(caseOf("defect","closed"),cmd("reopened",{reason:"Regression on a new release"}));
  assert.equal(reopened.state,"reopened");
  assert.equal(reopened.history[0].from,"closed");
});
test("invalid cross-kind transitions are rejected",()=>{
  assert.throws(()=>transition(caseOf("observation","quarantined"),cmd("in-progress")),TransitionError);
  assert.throws(()=>transition(caseOf("defect","resolved"),cmd("accepted-for-triage")),TransitionError);
});
