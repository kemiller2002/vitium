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
import { loadTable, evaluateTransition, promoteObservation, recordFact, permittedTargets, legalPairs } from "./lifecycle.mjs";

const loaded = loadTable(rawTable);
if (!loaded.ok) throw new Error("Invalid lifecycle table: " + loaded.error.message);
export const table = loaded.value;

export const observationStates = table.machines.observation.states;
export const defectStates = table.machines.defect.states;
export { permittedTargets, legalPairs };

/** Kept for API compatibility with service/triage-cli.mjs; carries a stable `code`. */
export class TransitionError extends Error {
  constructor(message, code = "invalid_payload") { super(message); this.name = "TransitionError"; this.code = code; }
}

// Legacy command shape ({evidenceId, classification, duplicateOf}) -> table command.
// A legacy evidenceId was untyped; it is recorded as evidence of the kind the legacy
// guard demanded for that edge (reproduction / verification) and flagged legacyEvidence,
// so its meaning is preserved without pretending it was typed at the source.
function fromLegacy(record, command) {
  if (!command || typeof command !== "object") return command;
  if (command.evidence !== undefined || command.fields !== undefined) return command;
  const machine = table.machines[record?.kind];
  const rule = machine?.transitions.find(t => t.from === record.state && t.to === command.to);
  const fields = {};
  for (const name of ["classification", "duplicateOf", "supersededBy", "severity", "priority", "confidence", "productId", "owner", "workItemRef"]) {
    if (command[name] !== undefined && command[name] !== null && command[name] !== "") fields[name] = command[name];
  }
  // The legacy API only ever read `classification` on the edge into "classified" and
  // ignored it elsewhere (service/triage-cli.mjs always passes --classification through).
  // Translate it the same way; the strict API still refuses undeclared fields.
  if ("classification" in fields && !(rule?.requiredFields.includes("classification") || rule?.optionalFields.includes("classification"))) {
    delete fields.classification;
  }
  const evidence = typeof command.evidenceId === "string" && command.evidenceId.trim()
    ? [{ kind: rule?.evidenceAnyOf[0] ?? "supporting", ref: command.evidenceId }]
    : [];
  return { ...command, fields, evidence };
}

/** Total variant: returns {ok,value:{record,event}} | {ok:false,error:{code,message}}. */
export function tryTransition(record, command) {
  const result = evaluateTransition(table, record, fromLegacy(record, command), { allowUnrecordedProvenance: true });
  if (!result.ok) return result;
  const legacy = command && command.evidence === undefined && command.fields === undefined && typeof command.evidenceId === "string";
  if (!legacy) return result;
  // Keep the legacy event field evidenceId so existing history readers still work.
  const event = Object.freeze({ ...result.value.event, evidenceId: command.evidenceId.trim(), legacyEvidence: true });
  const history = Object.freeze([...result.value.record.history.slice(0, -1), event]);
  return { ok: true, value: Object.freeze({ record: Object.freeze({ ...result.value.record, history }), event }) };
}

/** Legacy throwing API used by service/triage-cli.mjs. Returns the next record. */
export function transition(record, command) {
  const result = tryTransition(record, command);
  if (!result.ok) throw new TransitionError(result.error.message, result.error.code);
  return result.value.record;
}

export const promote = (observation, command) => promoteObservation(table, observation, command);
export const fact = (record, command) => recordFact(table, record, command);
