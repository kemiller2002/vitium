// Pure, table-driven lifecycle engine (VIT-LCY-001..004). The transition table is
// data (schemas/lifecycle/transitions.v1.json) passed in as a parameter, so this
// module and the F# core (domain/Vitium.Domain/Lifecycle.fs) enforce the same model.
// Candidate authority only: the table declares ordoAuthorized=false.
//
// Every function is total: it returns {ok:true,value} or {ok:false,error:{code,message}}.
// Nothing here reads clocks, storage, randomness or the network.

const ok = value => Object.freeze({ ok: true, value });
const fail = (code, message, detail) => Object.freeze({ ok: false, error: Object.freeze({ code, message, ...(detail ? { detail } : {}) }) });

export const errorCodes = Object.freeze([
  "invalid_table", "invalid_payload", "unknown_machine", "unknown_state", "missing_actor",
  "invalid_provenance", "stale_revision", "forbidden_transition", "unauthorized_role",
  "missing_reason", "reason_too_long", "invalid_timestamp", "unexpected_field", "missing_field",
  "invalid_field", "invalid_evidence", "missing_evidence", "self_reference", "invalid_defect_id",
  "unknown_fact", "inconsistent_history"
]);

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = v => typeof v === "string" && v.trim().length > 0;
const unique = list => new Set(list).size === list.length;
// A real ISO-8601 instant (VF-017): full date-time with seconds and an explicit offset,
// and every component in range (no Feb 30, no hour 24, no trailing text). The F# core
// uses the identical pattern and range rules (Identity.fs Patterns.instant / isInstant).
export const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
export function isInstant(text) {
  const m = typeof text === "string" ? INSTANT.exec(text) : null;
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const offH = m[7] === undefined ? 0 : Number(m[7]);
  const offM = m[8] === undefined ? 0 : Number(m[8]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return month >= 1 && month <= 12 && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59 && offH <= 23 && offM <= 59;
}
// Actor ids: Arca's ActorId alphabet (A-Z a-z 0-9 . _ : / -) widened to the IAM ARN
// alphabet (+ = , @) and 256 chars, because the provisional operator CLI uses the caller's
// IAM ARN. No whitespace or control characters. Same pattern in domain/Vitium.Domain.
const ACTOR_ID = /^[A-Za-z0-9._:\/+=,@-]{1,256}$/;
const EVIDENCE_REF_MAX = 512;
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// History is append-only and owned by the record, never by the caller (VF-016):
// - it must be an array whose count of non-creation events (sequence !== 0) equals the
//   revision, so a caller cannot erase events by supplying a truncated history;
// - events are deep-copied and frozen, so a caller cannot rewrite past events through an
//   alias to an array or object it still holds.
function ownHistory(record) {
  const history = record.history === undefined && record.revision === 0 ? [] : record.history;
  if (!Array.isArray(history) || !history.every(isObject)) return fail("inconsistent_history", "Record history is missing or malformed.");
  if (history.filter(e => e.sequence !== 0).length !== record.revision) return fail("inconsistent_history", "Record history does not match its revision.");
  return ok(Object.freeze(history.map(e => deepFreeze(structuredClone(e)))));
}

/** Validate the structural integrity of a transition table. Fails closed. */
export function loadTable(raw) {
  const bad = message => fail("invalid_table", message);
  if (!isObject(raw)) return bad("Table must be an object.");
  if (raw.schemaVersion !== "1.0") return bad("Unsupported table schemaVersion.");
  if (raw.ordoAuthorized !== false || raw.authority !== "vitium-domain-candidate") {
    return bad("Only the Vitium candidate table is accepted; Ordo authority is not claimed.");
  }
  const roles = raw.roles, provenances = raw.commandProvenances, kinds = raw.evidenceKinds, fields = raw.fields;
  if (!Array.isArray(roles) || !roles.length || !unique(roles)) return bad("roles must be a non-empty unique list.");
  if (!Array.isArray(provenances) || !provenances.every(p => (raw.provenances || []).includes(p))) return bad("commandProvenances must be a subset of provenances.");
  if (!isObject(kinds) || !isObject(fields) || !isObject(raw.machines)) return bad("evidenceKinds, fields and machines are required.");
  if (!Number.isSafeInteger(raw.reasonMaxLength) || raw.reasonMaxLength < 1) return bad("reasonMaxLength required.");
  for (const [name, def] of Object.entries(fields)) {
    if (!["text", "enum", "pattern"].includes(def?.type)) return bad("Unknown field type for " + name + ".");
  }
  const allStates = new Set();
  for (const [machine, def] of Object.entries(raw.machines)) {
    if (!Array.isArray(def?.states) || !def.states.length || !unique(def.states)) return bad(machine + " states invalid.");
    if (!def.states.includes(def.initial)) return bad(machine + " initial state unknown.");
    for (const s of def.states) {
      if (allStates.has(s)) return bad("State " + s + " belongs to more than one machine.");
      allStates.add(s);
    }
    const pairs = new Set();
    for (const t of def.transitions || []) {
      const pair = t.from + "->" + t.to;
      if (!def.states.includes(t.from) || !def.states.includes(t.to)) return bad("Transition " + pair + " references an unknown state.");
      if (pairs.has(pair)) return bad("Duplicate transition " + pair + ".");
      pairs.add(pair);
      if (!Array.isArray(t.roles) || !t.roles.length || !t.roles.every(r => roles.includes(r))) return bad("Transition " + pair + " has unknown roles.");
      if (t.reasonRequired !== true) return bad("Every transition requires a reason in this candidate model.");
      const declared = [...(t.requiredFields || []), ...(t.optionalFields || [])];
      if (!declared.every(f => f in fields) || !unique(declared)) return bad("Transition " + pair + " declares unknown fields.");
      if (!Array.isArray(t.evidenceAnyOf) || !t.evidenceAnyOf.every(k => k in kinds && k !== "unspecified")) return bad("Transition " + pair + " has invalid evidence kinds.");
    }
    for (const term of def.terminal || []) if (!def.states.includes(term)) return bad("Unknown terminal state " + term + ".");
  }
  const p = raw.promotion;
  if (!isObject(p) || !raw.machines[p.fromMachine]?.states.includes(p.fromState) || raw.machines[p.toMachine]?.initial !== p.toState) {
    return bad("Promotion must start from an existing observation state and create the defect initial state.");
  }
  if (!isObject(raw.facts) || !isObject(raw.facts.kinds)) return bad("facts.kinds required.");
  return ok(deepFreeze(structuredClone(raw)));
}

const findTransition = (table, machine, from, to) =>
  table.machines[machine].transitions.find(t => t.from === from && t.to === to) || null;

/** All legal (from,to) pairs of a machine, for exhaustive tests and UIs. */
export const legalPairs = (table, machine) =>
  (table.machines[machine]?.transitions || []).map(t => Object.freeze([t.from, t.to]));

/** Targets a role could choose from a state (UI controls must use this, VIT-LCY-001). */
export const permittedTargets = (table, machine, from, role) =>
  (table.machines[machine]?.transitions || []).filter(t => t.from === from && t.roles.includes(role)).map(t => t.to);

function checkField(def, value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (def.type === "enum") return def.values.includes(value);
  if (def.type === "pattern") return new RegExp(def.pattern, "u").test(value);
  return value.length <= (def.maxLength ?? 200) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function checkActor(table, command, { allowUnrecordedProvenance }) {
  if (typeof command.actor !== "string" || !ACTOR_ID.test(command.actor)) return fail("missing_actor", "Actor identity required.");
  const provenance = command.provenance ?? (allowUnrecordedProvenance ? "unrecorded" : undefined);
  if (!(table.commandProvenances.includes(provenance) || (allowUnrecordedProvenance && provenance === "unrecorded"))) {
    return fail("invalid_provenance", "Actor provenance class is required.");
  }
  return ok(provenance);
}

function checkEvidence(table, evidence) {
  if (evidence === undefined) return ok([]);
  if (!Array.isArray(evidence)) return fail("invalid_evidence", "Evidence must be a list.");
  for (const item of evidence) {
    if (!isObject(item) || !(item.kind in table.evidenceKinds) || !isText(item.ref) || item.ref.length > EVIDENCE_REF_MAX
      || Object.keys(item).some(k => k !== "kind" && k !== "ref")) {
      return fail("invalid_evidence", "Evidence items need a known kind and a bounded reference.");
    }
  }
  return ok(evidence.map(e => Object.freeze({ kind: e.kind, ref: e.ref.trim() })));
}

/**
 * Evaluate one lifecycle transition. Pure.
 * record:  { kind: "observation"|"defect", id?, state, revision, history? , triage? }
 * command: { to, expectedRevision, actor, provenance, role, reason, occurredAt, fields?, evidence? }
 * Returns { ok:true, value:{ record, event } } or { ok:false, error }.
 */
export function evaluateTransition(table, record, command, options = {}) {
  if (!isObject(record) || !isObject(command)) return fail("invalid_payload", "Invalid transition payload.");
  const machine = table.machines[record.kind];
  if (!machine) return fail("unknown_machine", "Unknown record kind.");
  if (!machine.states.includes(record.state)) return fail("unknown_state", "Unknown source state.");
  const actor = checkActor(table, command, options);
  if (!actor.ok) return actor;
  if (!Number.isSafeInteger(record.revision) || record.revision < 0 || record.revision !== command.expectedRevision) {
    return fail("stale_revision", "Stale or invalid revision.");
  }
  const owned = ownHistory(record);
  if (!owned.ok) return owned;
  const rule = findTransition(table, record.kind, record.state, command.to);
  if (!rule) return fail("forbidden_transition", "Transition not permitted.", { from: record.state, to: command.to ?? null });
  if (!rule.roles.includes(command.role)) return fail("unauthorized_role", rule.roleRationale || "The actor is not authorized.");
  if (!isText(command.reason)) return fail("missing_reason", "A bounded reason is required.");
  if (command.reason.length > table.reasonMaxLength) return fail("reason_too_long", "A bounded reason is required.");
  if (typeof command.occurredAt !== "string" || !isInstant(command.occurredAt)) return fail("invalid_timestamp", "Timestamp required.");
  const fields = command.fields ?? {};
  if (!isObject(fields)) return fail("invalid_field", "Fields must be an object.");
  const declared = [...rule.requiredFields, ...rule.optionalFields];
  const supplied = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null);
  const extra = supplied.find(([k]) => !declared.includes(k));
  if (extra) return fail("unexpected_field", "Field " + extra[0] + " is not permitted for this transition.");
  const missing = rule.requiredFields.find(f => !supplied.some(([k]) => k === f));
  if (missing) return fail("missing_field", missingFieldMessage(missing));
  const invalid = supplied.find(([k, v]) => !checkField(table.fields[k], v));
  if (invalid) return fail("invalid_field", "Field " + invalid[0] + " is invalid.");
  const evidence = checkEvidence(table, command.evidence);
  if (!evidence.ok) return evidence;
  if (rule.evidenceAnyOf.length && !evidence.value.some(e => rule.evidenceAnyOf.includes(e.kind))) {
    const label = table.evidenceKinds[rule.evidenceAnyOf[0]].label;
    return fail("missing_evidence", label + " evidence is required.", { anyOf: rule.evidenceAnyOf });
  }
  const selfRef = ["duplicateOf", "supersededBy"].find(f => fields[f] !== undefined && fields[f] === record.id);
  if (selfRef) return fail("self_reference", "A defect cannot be a " + selfRef + " of itself.");

  const cleanFields = Object.fromEntries(supplied.map(([k, v]) => [k, v.trim()]));
  const history = owned.value;
  const priorClosure = command.to === "reopened" ? lastDisposition(table, record.kind, history) : null;
  const event = deepFreeze({
    type: "transition", machine: record.kind, from: record.state, to: command.to,
    actor: command.actor, provenance: actor.value, role: command.role,
    reason: command.reason.trim(), fields: cleanFields, evidence: evidence.value,
    ...(priorClosure ? { reopens: priorClosure } : {}),
    occurredAt: command.occurredAt, sequence: record.revision + 1
  });
  const triageFields = Object.fromEntries(Object.entries(cleanFields).filter(([k]) => !["duplicateOf", "supersededBy", "workItemRef"].includes(k)));
  const next = {
    ...record, state: command.to, revision: record.revision + 1,
    history: Object.freeze([...history, event]),
    ...(Object.keys(triageFields).length ? { triage: Object.freeze({ ...(record.triage || {}), ...triageFields }) } : {})
  };
  return ok(Object.freeze({ record: Object.freeze(next), event }));
}

const missingFieldMessage = f => ({
  classification: "Classification required.",
  duplicateOf: "A duplicate disposition requires duplicateOf.",
  supersededBy: "A superseded disposition requires supersededBy."
}[f] || "Field " + f + " is required.");

// The most recent event that entered a disposition, so a reopen event points back at
// the closure evidence it overrides (VIT-AC-012). History itself is never rewritten.
function lastDisposition(table, machine, history) {
  const dispositions = table.machines[machine].dispositions || [];
  const found = [...history].reverse().find(e => e && dispositions.includes(e.to));
  return found ? Object.freeze({ sequence: found.sequence, state: found.to, evidence: found.evidence ?? [] }) : null;
}

/**
 * Promote a classified observation into a NEW defect identity (VIT-LCY-002). The
 * observation is never mutated into a defect: it keeps its kind and state and gains
 * an append-only link event. defectId is supplied by the caller (id effect is external).
 */
export function promoteObservation(table, observation, command) {
  const p = table.promotion;
  if (!isObject(observation) || !isObject(command)) return fail("invalid_payload", "Invalid promotion payload.");
  if (observation.kind !== p.fromMachine) return fail("unknown_machine", "Only observations can be promoted.");
  const actor = checkActor(table, command, {});
  if (!actor.ok) return actor;
  if (!Number.isSafeInteger(observation.revision) || observation.revision !== command.expectedRevision) return fail("stale_revision", "Stale or invalid revision.");
  const owned = ownHistory(observation);
  if (!owned.ok) return owned;
  if (observation.state !== p.fromState) return fail("forbidden_transition", "Only a classified observation can be promoted.");
  if (!p.roles.includes(command.role)) return fail("unauthorized_role", "The actor is not authorized.");
  if (!isText(command.reason)) return fail("missing_reason", "A bounded reason is required.");
  if (command.reason.length > table.reasonMaxLength) return fail("reason_too_long", "A bounded reason is required.");
  if (typeof command.occurredAt !== "string" || !isInstant(command.occurredAt)) return fail("invalid_timestamp", "Timestamp required.");
  if (typeof command.defectId !== "string" || !new RegExp(p.defectIdPattern).test(command.defectId)) return fail("invalid_defect_id", "A new defect identity is required.");
  if ((observation.links?.defectIds || []).includes(command.defectId)) return fail("invalid_defect_id", "Observation already linked to this defect.");
  const base = { actor: command.actor, provenance: actor.value, role: command.role, reason: command.reason.trim(), occurredAt: command.occurredAt };
  const linkEvent = deepFreeze({ type: "promoted", machine: p.fromMachine, defectId: command.defectId, ...base, sequence: observation.revision + 1 });
  const createdEvent = deepFreeze({ type: "created", machine: p.toMachine, to: p.toState, fromObservation: observation.observationId ?? null, ...base, sequence: 0 });
  const nextObservation = Object.freeze({
    ...observation, revision: observation.revision + 1,
    links: Object.freeze({ ...(observation.links || {}), defectIds: Object.freeze([...(observation.links?.defectIds || []), command.defectId]) }),
    history: Object.freeze([...owned.value, linkEvent])
  });
  const defect = deepFreeze({
    kind: p.toMachine, id: command.defectId, state: p.toState, revision: 0,
    observationIds: observation.observationId ? [observation.observationId] : [],
    history: [createdEvent]
  });
  return ok(Object.freeze({ observation: nextObservation, defect, event: linkEvent }));
}

/** Record a fix fact (merged/built/deployed/verified/reporter-confirmed). Never changes state. */
export function recordFact(table, record, command) {
  if (!isObject(record) || !isObject(command)) return fail("invalid_payload", "Invalid fact payload.");
  if (record.kind !== table.facts.machine) return fail("unknown_machine", "Facts apply to defects only.");
  const rule = table.facts.kinds[command.fact];
  if (!rule) return fail("unknown_fact", "Unknown fact kind.");
  const actor = checkActor(table, command, {});
  if (!actor.ok) return actor;
  if (!Number.isSafeInteger(record.revision) || record.revision !== command.expectedRevision) return fail("stale_revision", "Stale or invalid revision.");
  const owned = ownHistory(record);
  if (!owned.ok) return owned;
  if (!rule.roles.includes(command.role)) return fail("unauthorized_role", "The actor is not authorized.");
  if (typeof command.occurredAt !== "string" || !isInstant(command.occurredAt)) return fail("invalid_timestamp", "Timestamp required.");
  const evidence = checkEvidence(table, command.evidence);
  if (!evidence.ok) return evidence;
  if (rule.evidenceAnyOf.length && !evidence.value.some(e => rule.evidenceAnyOf.includes(e.kind))) {
    return fail("missing_evidence", table.evidenceKinds[rule.evidenceAnyOf[0]].label + " evidence is required.");
  }
  const event = deepFreeze({ type: "fact", machine: record.kind, fact: command.fact, state: record.state, actor: command.actor, provenance: actor.value, role: command.role, evidence: evidence.value, occurredAt: command.occurredAt, sequence: record.revision + 1 });
  return ok(Object.freeze({ record: Object.freeze({ ...record, revision: record.revision + 1, history: Object.freeze([...owned.value, event]) }), event }));
}
