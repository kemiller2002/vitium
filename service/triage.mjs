// Ordo-CANDIDATE transition semantics, driven by the single machine-readable table
// schemas/lifecycle/transitions.v1.json (VIT-LCY-001). The F# core in domain/ reads the
// same file, and tests/domain-lifecycle-contract.test.mjs checks both against shared cases.
// This module is NOT deployed as an admin API and is NOT Ordo-authorized
// (the table declares ordoAuthorized=false). Operators need a separately authorized
// persistence/identity boundary.
//
// Packaging note: the AWS Lambda candidate packages only service/ and never imports this
// module; it runs from a repository checkout (service/triage-cli.mjs).
import rawTable from "../schemas/lifecycle/transitions.v1.json" with { type: "json" };
import {
  loadTable, evaluateTransition, promoteObservation, recordFact, permittedTargets, legalPairs,
  recordInconclusive, recordEscalation, reopenAndResume, agentRepairBudget, verificationCycle
} from "./lifecycle.mjs";

const loaded = loadTable(rawTable);
if (!loaded.ok) throw new Error("Invalid lifecycle table: " + loaded.error.message);
export const table = loaded.value;

export const observationStates = table.machines.observation.states;
export const defectStates = table.machines.defect.states;
export { permittedTargets, legalPairs, verificationCycle };

/** Kept for API compatibility with service/triage-cli.mjs; carries a stable `code`. */
export class TransitionError extends Error {
  constructor(message, code = "invalid_payload") { super(message); this.name = "TransitionError"; this.code = code; }
}

// Legacy command shape ({evidenceId, classification, duplicateOf, attemptId, ...}) -> table
// command. A legacy evidenceId was untyped; it is recorded as evidence of the kind the table
// demands for that edge (reproduction, verification-request, verification-run, new-occurrence,
// ...) and flagged legacyEvidence, so its meaning is preserved without pretending it was
// typed at the source. Legacy events also carry their field values at the top level
// (attemptId, candidateRevision, verificationOutcome, affectedRelease, workItemId, evidenceId)
// so v1 history readers keep working (DOM-001 section 18).
const LEGACY_FIELDS = Object.freeze([
  "classification", "duplicateOf", "supersededBy", "severity", "priority", "confidence", "productId", "owner",
  "workItemRef", "attemptId", "candidateRevision", "verificationOutcome", "workItemId", "affectedRelease", "author"
]);
const ruleOf = (record, command) =>
  table.machines[record?.kind]?.transitions.find(t => t.from === record.state && t.to === command.to);

// Top-level legacy fields -> table fields. The legacy API only ever read `classification` on
// the edge into "classified" and ignored it elsewhere (service/triage-cli.mjs always passes
// --classification through); translate it the same way. The strict API still refuses
// undeclared fields.
function legacyFields(record, command) {
  const rule = ruleOf(record, command);
  const declared = rule ? [...rule.requiredFields, ...rule.optionalFields] : [];
  const fields = {};
  for (const name of LEGACY_FIELDS) {
    if (command[name] !== undefined && command[name] !== null && command[name] !== "") fields[name] = command[name];
  }
  if ("classification" in fields && !declared.includes("classification")) delete fields.classification;
  return fields;
}

function fromLegacy(record, command) {
  if (!command || typeof command !== "object") return command;
  if (command.fields !== undefined) return command;
  // Mixed shape (typed `evidence` list, legacy top-level fields): keep the typed evidence and
  // still read the top-level fields, which the strict API would otherwise ignore.
  if (command.evidence !== undefined) return { ...command, fields: legacyFields(record, command) };
  const rule = ruleOf(record, command);
  const evidence = typeof command.evidenceId === "string" && command.evidenceId.trim()
    ? [{ kind: rule?.evidenceAnyOf[0] ?? "supporting", ref: command.evidenceId }]
    : [];
  return { ...command, fields: legacyFields(record, command), evidence };
}

/**
 * @deprecated candidate-model-only. Legacy call shape kept solely for the user-authored
 * authority tests (tests/triage.test.mjs, tests/state-contract.test.mjs). It records
 * provenance "unrecorded" and does NOT enforce author independence or the human-verifier
 * rule (VF-034, DOM-001 s.29). Every event it emits carries `legacyUnguarded: true`, and the
 * strict path refuses to close a resolution produced here. Production modules must not
 * import it: tests/domain-legacy-containment.test.mjs fails if any module under service/
 * (other than this file) or site/ does.
 * Total variant: returns {ok,value:{record,event}} | {ok:false,error:{code,message}}.
 */
export function tryTransition(record, command) {
  // The legacy shape carries no trusted context: its provenance is "unrecorded", which the
  // engine treats as autonomous for the agent repair budget (VF-027) and exempts only from the
  // author-independence check, relying on the verifier role (Kevin's tests submit and verify
  // as one operator; DOM-001 sections 21 and 25-28).
  const legacyShape = command && command.fields === undefined;
  const result = evaluateTransition(table, record, fromLegacy(record, command), { allowUnrecordedProvenance: true });
  if (!result.ok) return result;
  const evidenceId = legacyShape && command.evidence === undefined && typeof command.evidenceId === "string" ? { evidenceId: command.evidenceId.trim(), legacyEvidence: true } : {};
  // Keep legacy top-level fields (evidenceId, attemptId, ...) so existing history readers still
  // work, and mark EVERY event emitted here as produced without the independence and
  // human-verifier guards (VF-034), so it can never pass for an independently verified result.
  const event = Object.freeze({ ...(legacyShape ? result.value.event.fields : {}), ...result.value.event, ...evidenceId, legacyUnguarded: true });
  const history = Object.freeze([...result.value.record.history.slice(0, -1), event]);
  return { ok: true, value: Object.freeze({ record: Object.freeze({ ...result.value.record, history }), event }) };
}

/**
 * @deprecated candidate-model-only. Throwing wrapper over tryTransition (same VF-034 caveats:
 * no author-independence or human-verifier enforcement; events marked legacyUnguarded).
 * service/triage-cli.mjs uses the strict lifecycle API, not this. Returns the next record.
 */
export function transition(record, command) {
  const result = tryTransition(record, command);
  if (!result.ok) throw new TransitionError(result.error.message, result.error.code);
  return result.value.record;
}

export const promote = (observation, command) => promoteObservation(table, observation, command);
export const fact = (record, command) => recordFact(table, record, command);

/** Inconclusive verification run: an event that keeps awaiting-verification (VIT-VER-010). */
export const inconclusive = (record, command) => recordInconclusive(table, record, command);
/** Human escalation event that opens a new autonomous repair budget (VIT-VER-011). */
export const escalate = (record, command) => recordEscalation(table, record, command);
/** Atomic "Reopen and resume": both guarded events or neither (VIT-LCY-011). */
export const reopenResume = (record, reopen, resume) => reopenAndResume(table, record, reopen, resume);
/** Pure bounded-repair policy; maxFailedAttempts defaults to the provisional table value. */
export const repairBudget = (history, maxFailedAttempts) => agentRepairBudget(table, history, maxFailedAttempts);
