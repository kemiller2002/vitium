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
  const prior=transition(caseOf("defect","in-progress"),cmd("awaiting-verification",{actor:"author-1",
    attemptId:"attempt-1",candidateRevision:"commit-1",evidenceId:"request-1"}));
  const verify=overrides=>cmd("resolved",{expectedRevision:1,actor:"verifier-1",...overrides});
  assert.throws(()=>transition(prior,verify({evidenceId:"test-123",attemptId:"attempt-1",candidateRevision:"commit-1",verificationOutcome:"passed"})),/Independent verification/);
  assert.throws(()=>transition(prior,verify({role:"verifier",attemptId:"attempt-1",candidateRevision:"commit-1",verificationOutcome:"passed"})),/Independent verification/);
  assert.throws(()=>transition(caseOf("defect","awaiting-verification"),cmd("resolved",{role:"verifier",evidenceId:"test-123",attemptId:"attempt-1",candidateRevision:"commit-1",verificationOutcome:"passed"})),/No submitted candidate/);
  const ok=transition(prior,verify({role:"verifier",evidenceId:"test-123",attemptId:"attempt-1",candidateRevision:"commit-1",verificationOutcome:"passed"}));
  assert.equal(ok.state,"resolved");
  assert.equal(ok.history[1].evidenceId,"test-123");
  assert.equal(prior.state,"awaiting-verification");
});
test("reproduction and closure dispositions require evidence and retain history",()=>{
  assert.throws(()=>transition(caseOf("defect","triaged"),cmd("confirmed")),/Reproduction/);
  const verified=transition(caseOf("defect","triaged"),cmd("confirmed",{evidenceId:"repro-1"}));
  assert.equal(verified.history.length,1);
  const reopened=transition(caseOf("defect","closed"),cmd("reopened",{reason:"Regression on a new release",evidenceId:"failing-run-8",affectedRelease:"v2.1"}));
  assert.equal(reopened.state,"reopened");
  assert.equal(reopened.history[0].from,"closed");
});
test("invalid cross-kind transitions are rejected",()=>{
  assert.throws(()=>transition(caseOf("observation","quarantined"),cmd("in-progress")),TransitionError);
  assert.throws(()=>transition(caseOf("defect","resolved"),cmd("accepted-for-triage")),TransitionError);
});

test("verification failure loops back to rework and preserves each attempt",()=>{
  let defect=caseOf("defect","in-progress");
  const apply=(to,overrides={})=>{
    defect=transition(defect,cmd(to,{expectedRevision:defect.revision,...overrides}));
  };
  apply("awaiting-verification",{attemptId:"fix-1",candidateRevision:"sha1",evidenceId:"submitted-run-1"});
  assert.throws(()=>transition(defect,cmd("in-progress",{
    expectedRevision:defect.revision,role:"verifier",actor:"verifier-1",attemptId:"fix-1",candidateRevision:"sha1",
    verificationOutcome:"failed"
  })),/evidence/);
  assert.throws(()=>transition(defect,cmd("in-progress",{
    expectedRevision:defect.revision,role:"triager",attemptId:"fix-1",candidateRevision:"sha1",
    verificationOutcome:"failed",evidenceId:"failed-test-1"
  })),/Independent verification/);
  apply("in-progress",{role:"verifier",actor:"verifier-1",attemptId:"fix-1",candidateRevision:"sha1",
    evidenceId:"failed-test-1",verificationOutcome:"failed",reason:"Route contract still fails"});
  assert.equal(defect.state,"in-progress");
  assert.equal(defect.history[1].verificationOutcome,"failed");
  apply("awaiting-verification",{attemptId:"fix-2",candidateRevision:"sha2",evidenceId:"submitted-run-2"});
  assert.throws(()=>transition(defect,cmd("resolved",{
    expectedRevision:defect.revision,role:"verifier",actor:"verifier-1",attemptId:"fix-2",
    candidateRevision:"sha2",evidenceId:"passed-test-2",verificationOutcome:"failed"
  })),/outcome/);
  assert.throws(()=>transition(defect,cmd("resolved",{
    expectedRevision:defect.revision,role:"verifier",actor:"verifier-1",attemptId:"fix-1",
    candidateRevision:"sha1",evidenceId:"passed-test-2",verificationOutcome:"passed"
  })),/submitted candidate/);
  apply("resolved",{role:"verifier",actor:"verifier-1",attemptId:"fix-2",candidateRevision:"sha2",
    evidenceId:"passed-test-2",verificationOutcome:"passed"});
  assert.equal(defect.state,"resolved");
  assert.deepEqual(defect.history.map(x=>x.sequence),[1,2,3,4]);
  assert.equal(defect.history[0].attemptId,"fix-1");
  assert.equal(defect.history[1].evidenceId,"failed-test-1");
  assert.equal(defect.history[3].evidenceId,"passed-test-2");
});

test("resolved regression is reopened before rework, preserving old passing evidence",()=>{
  const old={...caseOf("defect","resolved"),revision:1,history:[{from:"awaiting-verification",to:"resolved",
    attemptId:"fix-original",evidenceId:"passing-test-original",
    candidateRevision:"original-commit",verificationOutcome:"passed",sequence:1}]};
  assert.throws(()=>transition(old,cmd("in-progress",{expectedRevision:1})),/Transition not permitted/);
  assert.throws(()=>transition(old,cmd("reopened",{expectedRevision:1})),/recurrence evidence/);
  const reopened=transition(old,cmd("reopened",{expectedRevision:1,evidenceId:"new-failing-run",affectedRelease:"v2.0",
    reason:"Same regression in new release"}));
  assert.throws(()=>transition(reopened,cmd("in-progress",{expectedRevision:2})),/new work attempt/);
  assert.equal(reopened.history[1].priorResolutionSequence,1);
  const working=transition(reopened,cmd("in-progress",{expectedRevision:2,
    attemptId:"fix-regression-1",workItemId:"WI-303",
    reason:"Resume repair under linked Praxis work item"}));
  assert.equal(working.state,"in-progress");
  assert.equal(working.history.length,3);
  assert.equal(working.history[0].evidenceId,"passing-test-original");
  assert.equal(working.history[1].affectedRelease,"v2.0");
  assert.equal(working.history[2].workItemId,"WI-303");
  assert.equal(old.state,"resolved");
});

test("a stale concurrent verifier result cannot overwrite a new work attempt",()=>{
  const submitted=transition(caseOf("defect","in-progress"),
    cmd("awaiting-verification",{attemptId:"attempt-1",candidateRevision:"commit-a",evidenceId:"request-run-1"}));
  const failed=transition(submitted,cmd("in-progress",{expectedRevision:1,role:"verifier",actor:"verifier-1",
    attemptId:"attempt-1",candidateRevision:"commit-a",evidenceId:"failure-1",verificationOutcome:"failed"}));
  assert.throws(()=>transition(failed,cmd("resolved",{expectedRevision:1,role:"verifier",actor:"verifier-1",
    attemptId:"attempt-1",candidateRevision:"commit-a",evidenceId:"old-pass",verificationOutcome:"passed"})),/Stale/);
});
