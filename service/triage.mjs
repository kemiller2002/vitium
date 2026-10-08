// Pure Ordo-candidate transition semantics. This module is NOT deployed as an admin
// API and is NOT Ordo authority. Operators need a separately authorized
// persistence/identity boundary. Requirements: VIT-LCY-010..013, VIT-VER-009..011.
export const observationStates=Object.freeze(["received","quarantined","accepted-for-triage","classified","rejected"]);
export const defectStates=Object.freeze([
  "new","triaged","reproducing","confirmed","in-progress",
  "awaiting-verification","resolved","closed","duplicate","not-reproducible","reopened"
]);
export const roles=Object.freeze(["triager","verifier","administrator"]);
export const actorKinds=Object.freeze(["human","agent"]);
export const verificationOutcomes=Object.freeze(["passed","failed","inconclusive"]);
export const inconclusiveCauses=Object.freeze(["flaky","infrastructure","environment","timeout","missing-test"]);
// Field order of an immutable lifecycle event; mirrored by schemas/defect.schema.json.
export const eventFields=Object.freeze([
  "from","to","actor","actorKind","role","reason","evidenceId","classification",
  "verificationOutcome","inconclusiveCause","attemptId","candidateRevision","workItemId",
  "affectedRelease","priorResolutionSequence","occurredAt","sequence"
]);
// Provisional policy (docs/decisions/VIT-ADR-001). Ordo policy replaces it once qualified.
export const defaultPolicy=Object.freeze({requireIndependentVerifier:true,agentFailedAttemptLimit:3});

const graph=Object.freeze({
  received:["quarantined","accepted-for-triage","rejected"],
  quarantined:["accepted-for-triage","rejected"],
  "accepted-for-triage":["classified","quarantined","rejected"],
  classified:[],
  rejected:[],
  new:["triaged","duplicate","not-reproducible"],
  triaged:["reproducing","confirmed","duplicate","not-reproducible"],
  reproducing:["confirmed","triaged","not-reproducible"],
  confirmed:["in-progress","duplicate"],
  "in-progress":["awaiting-verification","triaged"],
  // The self-edge records an inconclusive run without deciding rework or resolution.
  "awaiting-verification":["resolved","in-progress","awaiting-verification"],
  resolved:["closed","reopened"],
  closed:["reopened"],
  duplicate:["reopened"],
  "not-reproducible":["reopened"],
  reopened:["triaged","reproducing","in-progress"]
});
export class TransitionError extends Error {
  constructor(message){super(message);this.name="TransitionError";}
}
const refuse=message=>{throw new TransitionError(message);};
const has=value=>typeof value==="string" && value.trim().length>0;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const lastWhere=(history,predicate)=>[...history].reverse().find(predicate);
const verificationOutcomeFor=Object.freeze({resolved:"passed","in-progress":"failed","awaiting-verification":"inconclusive"});

// Projections over the append-only history. They never mutate it.
export const latestSubmission=history=>lastWhere(history,event=>event.to==="awaiting-verification" && event.from!=="awaiting-verification");
const lastReopenIndex=history=>history.map(event=>event.to).lastIndexOf("reopened");
export const failedAttemptsInCycle=history=>
  history.slice(lastReopenIndex(history)+1).filter(event=>event.verificationOutcome==="failed").length;

// Each guard is (record, command, context) -> void and throws on refusal.
const guards=Object.freeze([
  function identity(record,command){
    if (!roles.includes(command.role)) refuse("The actor is not authorized.");
    if (!has(command.actor)) refuse("Actor identity required.");
    if (command.actorKind!==undefined && !actorKinds.includes(command.actorKind)) refuse("Unknown actor kind.");
  },
  function revision(record,command){
    if (!Number.isSafeInteger(record.revision) || record.revision<0 || record.revision!==command.expectedRevision) {
      refuse("Stale or invalid revision.");
    }
    if (record.history.length>record.revision) refuse("History is inconsistent with the record revision.");
  },
  function edge(record,command,{observation}){
    if (!(observation?observationStates:defectStates).includes(record.state)) refuse("Unknown source state.");
    if (!(graph[record.state]||[]).includes(command.to)) refuse("Transition not permitted.");
    if (!(observation?observationStates:defectStates).includes(command.to)) refuse("Cannot cross record kinds.");
  },
  function rationale(record,command){
    if (!has(command.reason) || command.reason.length>1000) refuse("A bounded reason is required.");
  },
  function chronology(record,command){
    if (!timestamp.test(command.occurredAt||"") || Number.isNaN(Date.parse(command.occurredAt))) refuse("Timestamp required.");
    const previous=lastWhere(record.history,event=>has(event.occurredAt));
    if (previous && Date.parse(command.occurredAt)<Date.parse(previous.occurredAt)) {
      refuse("Out-of-order event: it predates the latest recorded transition.");
    }
  },
  function outcomeScope(record,command,{verifying}){
    // A forged "passed" or "failed" flag on any other transition is refused, not ignored.
    if (!verifying && command.verificationOutcome!==undefined && command.verificationOutcome!==null) {
      refuse("A verification outcome is only accepted on a verification result.");
    }
    if (!verifying && has(command.inconclusiveCause)) refuse("An inconclusive cause is only accepted on an inconclusive result.");
  },
  function submission(record,command,{policy}){
    if (command.to!=="awaiting-verification" || record.state!=="in-progress") return;
    if (!has(command.attemptId) || !has(command.candidateRevision) || !has(command.evidenceId)) {
      refuse("Candidate attempt, revision and verification request evidence are required.");
    }
    if (submittedAttemptIds(record.history).has(command.attemptId)) refuse("Each verification submission requires a distinct attempt ID.");
    if (command.actorKind==="agent" && failedAttemptsInCycle(record.history)>=policy.agentFailedAttemptLimit) {
      refuse("Agent retry budget exhausted: escalate to an accountable human owner.");
    }
  },
  function verification(record,command,{verifying,policy}){
    if (!verifying) return;
    if (!["verifier","administrator"].includes(command.role) || !has(command.evidenceId) ||
        !has(command.attemptId) || !has(command.candidateRevision)) {
      refuse("Independent verification requires a verifier, attempt, revision and result evidence.");
    }
    if (command.verificationOutcome!==verificationOutcomeFor[command.to]) {
      refuse("Verification outcome must match the requested transition.");
    }
    const candidate=latestSubmission(record.history);
    if (!candidate) refuse("No submitted candidate attempt is recorded for verification.");
    if (candidate.attemptId!==command.attemptId || candidate.candidateRevision!==command.candidateRevision) {
      refuse("Verification result must refer to the submitted candidate attempt and revision.");
    }
    if (candidate.evidenceId===command.evidenceId) refuse("The verification request cannot serve as its own result evidence.");
    if (policy.requireIndependentVerifier && candidate.actor===command.actor) {
      refuse("Independent verification is required: the submitting actor cannot certify its own candidate.");
    }
    if (command.verificationOutcome==="inconclusive" && !inconclusiveCauses.includes(command.inconclusiveCause)) {
      refuse("An inconclusive result needs a recognised cause.");
    }
    if (command.verificationOutcome!=="inconclusive" && has(command.inconclusiveCause)) {
      refuse("An inconclusive cause is only accepted on an inconclusive result.");
    }
  },
  function reopening(record,command){
    if (command.to==="reopened" && (!has(command.evidenceId) || !has(command.affectedRelease))) {
      refuse("Reopening requires recurrence evidence and affected release.");
    }
  },
  function resumption(record,command){
    if (record.state!=="reopened" || command.to!=="in-progress") return;
    if (!has(command.attemptId) || !has(command.workItemId)) {
      refuse("Resuming a reopened defect requires a new work attempt and work item.");
    }
    if (submittedAttemptIds(record.history).has(command.attemptId) || resumedAttemptIds(record.history).has(command.attemptId)) {
      refuse("Resuming a reopened defect requires a new work attempt and work item.");
    }
  },
  function dispositions(record,command){
    if (command.to==="confirmed" && !has(command.evidenceId)) refuse("Reproduction evidence required.");
    if (command.to==="classified" && !has(command.classification)) refuse("Classification required.");
  }
]);
const submittedAttemptIds=history=>new Set(history
  .filter(event=>event.to==="awaiting-verification" && event.from!=="awaiting-verification")
  .map(event=>event.attemptId).filter(has));
const resumedAttemptIds=history=>new Set(history
  .filter(event=>event.from==="reopened" && event.to==="in-progress")
  .map(event=>event.attemptId).filter(has));

const buildEvent=(record,command)=>Object.freeze({
  from:record.state,to:command.to,actor:command.actor.trim(),actorKind:command.actorKind||"human",role:command.role,
  reason:command.reason.trim(),evidenceId:command.evidenceId||null,
  classification:command.classification||null,
  verificationOutcome:command.verificationOutcome||null,
  inconclusiveCause:command.inconclusiveCause||null,
  attemptId:command.attemptId||null,
  candidateRevision:command.candidateRevision||null,
  workItemId:command.workItemId||null,
  affectedRelease:command.affectedRelease||null,
  // Reopening links, rather than rewrites, the resolution it supersedes.
  priorResolutionSequence:command.to==="reopened"
    ? lastWhere(record.history,event=>event.to==="resolved")?.sequence ?? null
    : null,
  occurredAt:command.occurredAt,
  sequence:record.revision+1
});

export function transition(record, command, policy=defaultPolicy) {
  if (!record || !command || typeof record!=="object" || typeof command!=="object") refuse("Invalid transition payload");
  const observation=record.kind==="observation";
  if (!observation && record.kind!=="defect") refuse("Unknown record kind.");
  const history=Array.isArray(record.history)?record.history:[];
  const subject={...record,history};
  const verifying=!observation && record.state==="awaiting-verification" &&
    ["resolved","in-progress","awaiting-verification"].includes(command.to);
  guards.forEach(guard=>guard(subject,command,{observation,verifying,policy:{...defaultPolicy,...policy}}));
  const event=buildEvent(subject,command);
  return Object.freeze({
    ...record,state:command.to,revision:record.revision+1,
    history:Object.freeze([...history,event])
  });
}

// "Reopen and resume" (VIT-LCY-011): both legal events are recorded, or neither is.
export function reopenAndResume(record, reopen, resume, policy=defaultPolicy) {
  const reopened=transition(record,reopen,policy);
  return transition(reopened,{...resume,to:resume.to||"in-progress",expectedRevision:reopened.revision},policy);
}

// Read model of every repair attempt, derived from (never replacing) the history.
export function verificationAttempts(record) {
  const history=Array.isArray(record?.history)?record.history:[];
  const submissions=history.filter(event=>event.to==="awaiting-verification" && event.from!=="awaiting-verification");
  return Object.freeze(submissions.map(submitted=>Object.freeze({
    attemptId:submitted.attemptId,
    candidateRevision:submitted.candidateRevision,
    submittedBy:submitted.actor,
    requestEvidenceId:submitted.evidenceId,
    submittedSequence:submitted.sequence,
    results:Object.freeze(history
      .filter(event=>event.from==="awaiting-verification" && event.attemptId===submitted.attemptId &&
        event.candidateRevision===submitted.candidateRevision && event.sequence>submitted.sequence)
      .map(event=>Object.freeze({
        outcome:event.verificationOutcome,verifier:event.actor,evidenceId:event.evidenceId,
        inconclusiveCause:event.inconclusiveCause,sequence:event.sequence
      })))
  })));
}
