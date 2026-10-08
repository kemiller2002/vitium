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
// Identities compare case-, width- and whitespace-insensitively so "Alice " cannot pose as an independent verifier.
export const sameActor=(a,b)=>has(a) && has(b) && a.normalize("NFKC").trim().toLowerCase()===b.normalize("NFKC").trim().toLowerCase();
const foldId=value=>has(value)?value.normalize("NFKC").trim().toLowerCase():null;
const optionalText=["evidenceId","classification","attemptId","candidateRevision","workItemId","affectedRelease"];
// Untrusted command fields become bounded, trimmed strings (or are refused) before any guard runs.
function normalizeCommand(command){
  const text=(key,max)=>{
    const value=command[key];
    if (value===undefined || value===null) return undefined;
    if (typeof value!=="string") refuse(key+" must be text.");
    const clean=value.trim();
    if (clean.length>max) refuse(key+" is too long.");
    if (/[\u0000-\u001f\u007f]/u.test(clean)) refuse(key+" contains invalid characters.");
    return clean||undefined;
  };
  return Object.freeze({
    ...command,
    actor:text("actor",200),
    reason:typeof command.reason==="string"?command.reason:undefined,
    ...Object.fromEntries(optionalText.map(key=>[key,text(key,200)])),
    inconclusiveCause:text("inconclusiveCause",40),
    verificationOutcome:command.verificationOutcome??undefined
  });
}
// Policy values that are absent keep the safe default; malformed values are refused.
function resolvePolicy(policy){
  const defined=Object.fromEntries(Object.entries(policy||{}).filter(([,value])=>value!==undefined));
  const merged={...defaultPolicy,...defined};
  if (typeof merged.requireIndependentVerifier!=="boolean") refuse("Invalid verification policy.");
  if (!Number.isSafeInteger(merged.agentFailedAttemptLimit) || merged.agentFailedAttemptLimit<1) refuse("Invalid agent retry policy.");
  return Object.freeze(merged);
}
// The supplied history must be exactly the gap-free, chained log the revision claims.
function assertHistoryIntegrity(record,history){
  if (!Number.isSafeInteger(record.revision) || history.length!==record.revision) refuse("History is inconsistent with the record revision.");
  history.forEach((event,index)=>{
    if (!event || event.sequence!==index+1) refuse("History is inconsistent with the record revision.");
    if (index>0 && event.from!==undefined && event.from!==history[index-1].to) refuse("History is not a continuous transition chain.");
  });
  if (history.length>0 && history.at(-1).to!==record.state) refuse("History does not end in the record state.");
}
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
    // Submissions feed the agent retry budget, so the actor kind must be explicit, never defaulted.
    if (record.state==="in-progress" && command.to==="awaiting-verification" && !actorKinds.includes(command.actorKind)) {
      refuse("A verification submission must declare whether the actor is a human or an agent.");
    }
  },
  function revision(record,command){
    if (!Number.isSafeInteger(record.revision) || record.revision<0 || record.revision!==command.expectedRevision) {
      refuse("Stale or invalid revision.");
    }
    assertHistoryIntegrity(record,record.history);
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
    if (submittedAttemptIds(record.history).has(foldId(command.attemptId))) refuse("Each verification submission requires a distinct attempt ID.");
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
    if (foldId(candidate.attemptId)!==foldId(command.attemptId) || candidate.candidateRevision!==command.candidateRevision) {
      refuse("Verification result must refer to the submitted candidate attempt and revision.");
    }
    if (candidate.evidenceId===command.evidenceId) refuse("The verification request cannot serve as its own result evidence.");
    if (policy.requireIndependentVerifier && sameActor(candidate.actor,command.actor)) {
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
    if (command.to!=="reopened") return;
    if (!has(command.evidenceId) || !has(command.affectedRelease)) {
      refuse("Reopening requires recurrence evidence and affected release.");
    }
    // Recurrence must be new evidence, not a citation of evidence already in the log.
    if (record.history.some(event=>foldId(event.evidenceId)===foldId(command.evidenceId))) {
      refuse("Reopening requires new recurrence evidence, not previously recorded evidence.");
    }
  },
  function resumption(record,command){
    if (record.state!=="reopened" || command.to!=="in-progress") return;
    if (!has(command.attemptId) || !has(command.workItemId)) {
      refuse("Resuming a reopened defect requires a new work attempt and work item.");
    }
    if (submittedAttemptIds(record.history).has(foldId(command.attemptId)) || resumedAttemptIds(record.history).has(foldId(command.attemptId))) {
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
  .map(event=>foldId(event.attemptId)).filter(Boolean));
const resumedAttemptIds=history=>new Set(history
  .filter(event=>event.from==="reopened" && event.to==="in-progress")
  .map(event=>foldId(event.attemptId)).filter(Boolean));

const buildEvent=(record,command)=>Object.freeze({
  from:record.state,to:command.to,actor:command.actor,actorKind:command.actorKind||"human",role:command.role,
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

export function transition(record, rawCommand, rawPolicy=defaultPolicy) {
  if (!record || !rawCommand || typeof record!=="object" || typeof rawCommand!=="object") refuse("Invalid transition payload");
  const command=normalizeCommand(rawCommand);
  const policy=resolvePolicy(rawPolicy);
  const observation=record.kind==="observation";
  if (!observation && record.kind!=="defect") refuse("Unknown record kind.");
  const history=Array.isArray(record.history)?record.history:[];
  const subject={...record,history};
  const verifying=!observation && record.state==="awaiting-verification" &&
    ["resolved","in-progress","awaiting-verification"].includes(command.to);
  guards.forEach(guard=>guard(subject,command,{observation,verifying,policy}));
  const event=buildEvent(subject,command);
  return Object.freeze({
    ...record,state:command.to,revision:record.revision+1,
    history:Object.freeze([...history,event])
  });
}

// "Reopen and resume" (VIT-LCY-011): both legal events are recorded, or neither is.
export function reopenAndResume(record, reopen, resume, policy=defaultPolicy) {
  if (!["resolved","closed"].includes(record?.state)) refuse("Reopen and resume applies only to resolved or closed defects.");
  const reopened=transition(record,{...reopen,to:"reopened"},policy);
  const target=resume?.to??"in-progress";
  if (!["in-progress","reproducing"].includes(target)) refuse("Reopen and resume continues only to in-progress or reproducing.");
  return transition(reopened,{...resume,to:target,expectedRevision:reopened.revision},policy);
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
