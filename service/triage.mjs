// Pure Ordo-candidate transition semantics. This module is NOT deployed as an admin
// API. Operators need a separately authorized persistence/identity boundary.
export const observationStates=Object.freeze(["received","quarantined","accepted-for-triage","classified","rejected"]);
export const defectStates=Object.freeze([
  "new","triaged","reproducing","confirmed","in-progress",
  "awaiting-verification","resolved","closed","duplicate","not-reproducible","reopened"
]);
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
  "awaiting-verification":["resolved","in-progress"],
  resolved:["closed","reopened"],
  closed:["reopened"],
  duplicate:["reopened"],
  "not-reproducible":["reopened"],
  reopened:["triaged","reproducing"]
});
export class TransitionError extends Error {
  constructor(message){super(message);this.name="TransitionError";}
}
export function transition(record, command) {
  if (!record || !command || typeof record!=="object" || typeof command!=="object") throw new TransitionError("Invalid transition payload");
  if (!["triager","verifier","administrator"].includes(command.role)) throw new TransitionError("The actor is not authorized.");
  if (typeof command.actor!=="string" || !command.actor.trim()) throw new TransitionError("Actor identity required.");
  if (!Number.isSafeInteger(record.revision) || record.revision<0 || record.revision!==command.expectedRevision) {
    throw new TransitionError("Stale or invalid revision.");
  }
  const observation=record.kind==="observation";
  if (!observation && record.kind!=="defect") throw new TransitionError("Unknown record kind.");
  if (!(observation?observationStates:defectStates).includes(record.state)) throw new TransitionError("Unknown source state.");
  const targets=graph[record.state]||[];
  if (!targets.includes(command.to)) throw new TransitionError("Transition not permitted.");
  if (!observation && !defectStates.includes(command.to)) throw new TransitionError("Cannot cross record kinds.");
  if (observation && !observationStates.includes(command.to)) throw new TransitionError("Cannot cross record kinds.");
  if (typeof command.reason!=="string" || !command.reason.trim() || command.reason.length>1000) throw new TransitionError("A bounded reason is required.");
  if (command.to==="resolved" && (command.role!=="verifier" && command.role!=="administrator" || !command.evidenceId)) {
    throw new TransitionError("Independent verification evidence is required.");
  }
  if (command.to==="confirmed" && !command.evidenceId) throw new TransitionError("Reproduction evidence required.");
  if (command.to==="classified" && !command.classification) throw new TransitionError("Classification required.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(command.occurredAt||"")) throw new TransitionError("Timestamp required.");
  const event=Object.freeze({
    from:record.state,to:command.to,actor:command.actor,role:command.role,
    reason:command.reason.trim(),evidenceId:command.evidenceId||null,
    classification:command.classification||null,occurredAt:command.occurredAt,
    sequence:record.revision+1
  });
  return Object.freeze({
    ...record,state:command.to,revision:record.revision+1,
    history:Object.freeze([...(record.history||[]),event])
  });
}
