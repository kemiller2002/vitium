// Pure machine-observation intake core (VIT-INT-013..017, VIT-DOM-005, VIT-AC-032/035/036).
// PROPOSED contract; no deployed route calls this (see docs/machine/MACHINE-OBSERVATION-CONTRACT.md).
//
// Shape (mirrors service/intake.mjs): small pure decision functions plus one orchestration
// function whose ONLY effects are injected ports. Expected failures are typed Result values.
//
// Ports (all injected):
//   store.putOnce(item) -> Result<
//        {created:true}
//      | {created:false, existing:{eventId, canonicalHash, observationId, receivedAt}}     (same eventId already stored)
//      | {created:false, attemptTaken:{eventId, eventType, observedAt}},                     (attemptKey already has a result)
//      "unavailable"|"throttled">
//     Conditional-put semantics: the store MUST atomically refuse a second item with the same
//     pk (eventId) and, when item.attemptKey is non-null, a second item with the same attemptKey.
//   store.lookupEvent(eventId) -> Result<{found:boolean}, "unavailable"|"throttled">   (causation ordering)
//   lookupAttempt(defectId, attemptId) -> Result<{found:false} | {found:true, author:{principalId}}, "unavailable">
//     OPTIONAL. Who authored the repair attempt under verification. Without it no proposal is
//     ever produced for verification results (fail closed: independence cannot be shown).
//   now() -> ISO-8601 string;  observationId() -> "OBS-<32 hex>"
//
// What this core NEVER does (VIT-AC-032/036): call the lifecycle, set a defect state, or
// store anything other than an untriaged observation. A verification result can at most
// carry a *proposal* for a separate human/Ordo-guarded path; the proposal is deliberately
// not an executable lifecycle command (no actor, role, expectedRevision or reason).
import { createHash } from "node:crypto";
import { screenReport, redactText } from "../redaction.mjs";
import { BOUNDS, SECURITY_CATEGORIES, SECURITY_SYSTEMS, VERIFICATION_EVENT_TYPES, validateEnvelope, findCredentialField } from "./contract.mjs";
import { authorize, isVerifiedPrincipal } from "./principal.mjs";
import { ok, fail, machineFailure } from "./errors.mjs";

const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
const sha256 = text => createHash("sha256").update(text, "utf8").digest("hex");
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** Canonical JSON: object keys sorted recursively, so key order never changes the hash. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isObject(value)) return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

// --- parsing -------------------------------------------------------------------------

/** Pure: raw body text -> Result<parsed JSON>. Size is measured in UTF-8 bytes before parsing. */
export function parseBody(text) {
  if (typeof text !== "string") return fail(machineFailure("invalid_json"));
  if (Buffer.byteLength(text, "utf8") > BOUNDS.maxBodyBytes) return fail(machineFailure("payload_too_large"));
  try { return ok(JSON.parse(text)); } catch { return fail(machineFailure("invalid_json")); }
}

/** Pure: parsed JSON -> Result<validated frozen envelope>. Credential-named fields refused first. */
export function checkEnvelope(raw) {
  const credentialPath = findCredentialField(raw);
  if (credentialPath) return fail(machineFailure("credential_in_body"));
  const v = validateEnvelope(raw);
  if (v.ok) return v;
  const { code, path } = v.error;
  if (code === "invalid_envelope" && /^\$\.evidence\[\d+\]\.uri$/.test(path)) return fail(machineFailure("unsafe_evidence", path));
  return fail(machineFailure(code === "unsupported_version" ? "unsupported_version" : "invalid_envelope", path));
}

// --- screening ------------------------------------------------------------------------

// Single-line log/stack-trace content (newlines are already structurally impossible).
const LOG_DUMP = [
  /\bat [\w$.<>\[\]]+ \([^()]*:\d+:\d+\)/g,              // JS stack frames
  /Traceback \(most recent call last\)/g,                 // Python
  /\bat [\w$.]+\([\w$]+\.(?:java|kt|scala):\d+\)/g,       // JVM frames
  /\bin [^ ]+\.(?:fs|cs|vb):line \d+/g,                   // .NET frames
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z? +(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/g // log lines
];
export const LOG_DUMP_THRESHOLD = 2;
const countMatches = (text, re) => (text.match(re) || []).length;
export const looksLikeLogDump = text => LOG_DUMP.some(re => countMatches(text, re) >= LOG_DUMP_THRESHOLD)
  || countMatches(text, /Traceback \(most recent call last\)/g) >= 1;

/**
 * Pure: validated envelope -> Result<{envelope (redacted), screening}>.
 * Reuses service/redaction.mjs: credentials in finding text are replaced before hashing or
 * storage and the observation is quarantined. Evidence URIs that still carry a credential
 * pattern (e.g. a token in the path) are refused, never stored. Log dumps are refused.
 */
export function screenEnvelope(envelope) {
  const f = envelope.finding;
  for (const text of [f.summary, f.expected, f.observed]) {
    if (looksLikeLogDump(text)) return fail(machineFailure("log_dump_refused", "$.finding"));
  }
  for (let i = 0; i < envelope.evidence.length; i++) {
    if (redactText(envelope.evidence[i].uri).findings.length) return fail(machineFailure("unsafe_evidence", "$.evidence[" + i + "].uri"));
  }
  const { report, screening } = screenReport({ title: f.summary, actual: f.observed, expected: f.expected });
  const redacted = deepFreeze({
    ...structuredClone(envelope),
    finding: { ...structuredClone(f), summary: report.title, observed: report.actual, expected: report.expected }
  });
  return ok(Object.freeze({ envelope: redacted, screening }));
}

// --- classification, routing, fingerprint -----------------------------------------------

/** VIT-DOM-005: provenance class from the VERIFIED principal's system, never invented. */
export const provenanceFor = system => system === "ci" ? "ci" : system === "agent" ? "agent" : "application";

/** Echo: Vitium-originated events (marker) or a Vitium principal. Dropped, never stored (VIT-INT-015). */
export const isEcho = (envelope, principal) =>
  principal?.system === "vitium" || envelope.source.system === "vitium" || (envelope.correlation.originMarker ?? null) !== null;

/** Security-classified routing (Tutela / security categories / vulnerability language). */
export function routeFor(envelope, screening) {
  const security = SECURITY_CATEGORIES.includes(envelope.finding.category)
    || SECURITY_SYSTEMS.includes(envelope.source.system)
    || screening.escalation === "security";
  return Object.freeze(security
    ? { visibility: "private-security", securityClassified: true, publicProjection: "never" }
    : { visibility: "private", securityClassified: false, publicProjection: "after-human-review" });
}

/**
 * Pure gate for ANY future public projection of a machine observation. Security-classified
 * records are never eligible, whatever approval is offered.
 */
export function mayProjectPublicly(record, approval) {
  if (!isObject(record) || record.visibility !== "private" || record.securityClassified !== false || record.publicProjection !== "after-human-review") {
    return fail(Object.freeze({ code: "projection_forbidden", message: "This observation can never be projected publicly." }));
  }
  if (!isObject(approval) || typeof approval.approvedBy !== "string" || !approval.approvedBy.trim()) {
    return fail(Object.freeze({ code: "projection_requires_review", message: "Public projection requires a recorded human review." }));
  }
  return ok(Object.freeze({ eligible: true, approvedBy: approval.approvedBy }));
}

/** Normalize a failure signature so volatile tokens (ids, hashes, numbers, paths' digits) do not split candidates. */
export function normalizeSignature(text) {
  return text.normalize("NFC").toLowerCase()
    .replace(/\[redacted\]/g, "<redacted>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/g, "<hex>")
    .replace(/\b[0-9a-f]{7,64}\b/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/ +/g, " ")
    .trim();
}

/**
 * Candidate-duplicate key (NOT a merge decision): repository + check + category +
 * normalized summary/observed signature. Commit, run, attempt and environment are
 * deliberately excluded so the same failure across runs/commits correlates.
 */
export function fingerprint(envelope) {
  const parts = [
    envelope.source.repository.toLowerCase(), envelope.subject.checkId, envelope.finding.category,
    normalizeSignature(envelope.finding.summary), normalizeSignature(envelope.finding.observed)
  ];
  return "FP-" + sha256(parts.join("\u0000"));
}

/** Idempotency hash of the canonical (redacted) envelope. */
export const canonicalHash = envelope => sha256(canonicalJson(envelope));

const attemptKeyFor = e => VERIFICATION_EVENT_TYPES.includes(e.eventType)
  ? "ATTEMPT#" + e.correlation.defectId + "#" + e.correlation.verificationAttemptId : null;

// --- verification: flags and (non-executable) proposals ---------------------------------

const INCONCLUSIVE_CATEGORIES = Object.freeze(["infrastructure-error", "flaky-test"]);

/**
 * Pure: decide what a verification event may contribute. Returns
 * {outcome, flags[], proposal|null, withheldReason|null}. Never a state, never applied.
 *   attempt: undefined (no port) | {found:false} | {found:true, author:{principalId}}
 */
export function assessVerification(envelope, principal, attempt) {
  if (!VERIFICATION_EVENT_TYPES.includes(envelope.eventType)) return Object.freeze({ outcome: null, flags: Object.freeze([]), proposal: null, withheldReason: null });
  const outcome = envelope.eventType.slice("verification.".length);
  const flags = [];
  const withhold = reason => deepFreeze({ outcome, flags, proposal: null, withheldReason: reason });
  if (outcome === "inconclusive") { flags.push("inconclusive"); return withhold("inconclusive-result"); }
  if (INCONCLUSIVE_CATEGORIES.includes(envelope.finding.category)) { flags.push("possibly-inconclusive"); return withhold("infrastructure-or-flaky-category"); }
  if (envelope.finding.confidence !== "observed") { flags.push("unconfirmed-result"); return withhold("not-observed"); }
  if (attempt === undefined) return withhold("attempt-author-unknown");
  if (!attempt.found) { flags.push("unknown-attempt"); return withhold("unknown-attempt"); }
  if (attempt.author?.principalId === principal.principalId) { flags.push("self-certification"); return withhold("self-certification"); }
  const proposal = {
    kind: "proposed-transition",
    status: "proposed",
    applied: false,
    authority: "none: requires a human or Ordo-guarded transition with independent review",
    defectId: envelope.correlation.defectId,
    expectedFrom: "awaiting-verification",
    suggestedTarget: outcome === "failed" ? "in-progress" : "resolved",
    verificationOutcome: outcome,
    verificationAttemptId: envelope.correlation.verificationAttemptId,
    candidateRevision: envelope.subject.commit,
    runId: envelope.subject.runId,
    reportedVerifier: { principalId: principal.principalId, system: principal.system },
    evidence: envelope.evidence.map(x => ({ kind: x.kind, uri: x.uri, sha256: x.sha256 })),
    sourceEventId: envelope.eventId
  };
  return deepFreeze({ outcome, flags, proposal, withheldReason: null });
}

// --- record and acknowledgement -----------------------------------------------------------

/** Pure: the private stored observation. Always untriaged; never a defect; never a lifecycle state beyond received/quarantined. */
export function buildRecord({ envelope, screening, principal, verification, observationId, receivedAt }) {
  const route = routeFor(envelope, screening);
  const flags = [...new Set([...screening.flags, ...verification.flags])].sort();
  return deepFreeze({
    schemaVersion: "1.0",
    kind: "machine-observation",
    pk: "MEVENT#" + envelope.eventId,
    attemptKey: attemptKeyFor(envelope),
    observationId,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    canonicalHash: canonicalHash(envelope),
    envelope,
    principal: { principalId: principal.principalId, system: principal.system },
    provenance: provenanceFor(principal.system),
    classification: "untriaged",
    state: screening.disposition, // "received" | "quarantined" (observation machine initial states only)
    ...route,
    screening: { flags: screening.flags, redactions: screening.redactions },
    flags,
    candidate: { fingerprint: fingerprint(envelope), kind: "duplicate-candidate", mergeDecision: null },
    occurrence: {
      repository: envelope.source.repository, commit: envelope.subject.commit, runId: envelope.subject.runId,
      runAttempt: envelope.subject.runAttempt ?? null, checkId: envelope.subject.checkId, environment: envelope.subject.environment
    },
    verification,
    revision: 0,
    history: [],
    observedAt: envelope.observedAt,
    receivedAt
  });
}

/** Pure: producer acknowledgement. Same eventId + same content -> same ack (replayed:true). */
export const ackFor = ({ eventId, observationId, receivedAt }, replayed) => Object.freeze({
  schemaVersion: "1.0", eventId, observationId, receivedAt, status: "recorded", replayed
});

/** Pure: interpret the conditional-put outcome for a candidate record. */
export function decidePut(record, outcome) {
  if (!isObject(outcome) || typeof outcome.ok !== "boolean") return fail(machineFailure("storage_unavailable"));
  if (!outcome.ok) return fail(machineFailure(outcome.error === "throttled" ? "throttled" : "storage_unavailable"));
  const v = outcome.value;
  if (v?.created === true) return ok(ackFor(record, false));
  if (v?.created !== false) return fail(machineFailure("storage_unavailable"));
  if (isObject(v.existing)) {
    if (typeof v.existing.canonicalHash !== "string") return fail(machineFailure("storage_unavailable"));
    if (v.existing.canonicalHash !== record.canonicalHash) return fail(machineFailure("event_conflict"));
    if (typeof v.existing.observationId !== "string" || typeof v.existing.receivedAt !== "string") return fail(machineFailure("storage_unavailable"));
    return ok(ackFor({ eventId: record.eventId, observationId: v.existing.observationId, receivedAt: v.existing.receivedAt }, true));
  }
  if (isObject(v.attemptTaken) && typeof v.attemptTaken.observedAt === "string") {
    return fail(machineFailure(Date.parse(record.observedAt) < Date.parse(v.attemptTaken.observedAt) ? "stale_event" : "attempt_conflict"));
  }
  return fail(machineFailure("storage_unavailable"));
}

// --- effect normalisers ---------------------------------------------------------------------
const asResult = v => isObject(v) && typeof v.ok === "boolean" ? v : null;
async function settle(effect, ...args) {
  let value;
  try { value = await effect(...args); } catch { return fail("unavailable"); }
  return asResult(value) ?? fail("unavailable");
}

/**
 * Orchestration. submit({principal, body}) -> Promise<Result<
 *   {disposition:"recorded", ack, record?} | {disposition:"echo-suppressed"}, failure>>
 * `principal` must come from makePrincipalVerifier (transport credential, not the body).
 * `body` is the raw request text.
 */
export function makeMachineIntake({ store, now, observationId, lookupAttempt }) {
  if (typeof store?.putOnce !== "function" || typeof store?.lookupEvent !== "function" || typeof now !== "function" || typeof observationId !== "function") {
    throw new TypeError("Machine intake requires store.putOnce, store.lookupEvent, now and observationId effects.");
  }
  return Object.freeze({
    async submit({ principal, body } = {}) {
      // 1. Authentication precedes any parsing feedback.
      if (principal === undefined || principal === null) return fail(machineFailure("unauthenticated"));
      if (!isVerifiedPrincipal(principal)) return fail(machineFailure("invalid_principal"));
      const at = now();
      // 2. Bounded parse and closed-schema validation.
      const parsed = parseBody(body);
      if (!parsed.ok) return parsed;
      const checked = checkEnvelope(parsed.value);
      if (!checked.ok) return checked;
      const envelope = checked.value;
      // 3. Authorization from verified scopes; caller-supplied source must agree.
      const authz = authorize(principal, envelope, at);
      if (!authz.ok) return fail(machineFailure(authz.error.code));
      // 4. Echo suppression: no record, no ack id, no recursion.
      if (isEcho(envelope, principal)) return ok(Object.freeze({ disposition: "echo-suppressed", eventId: envelope.eventId }));
      // 5. Safety screening (redaction, log-dump and evidence refusal).
      const screened = screenEnvelope(envelope);
      if (!screened.ok) return screened;
      // 6. Causal ordering: the causing event must already be recorded.
      const cause = envelope.correlation.causationEventId;
      if (cause !== null) {
        const found = await settle(store.lookupEvent, cause);
        if (!found.ok) return fail(machineFailure(found.error === "throttled" ? "throttled" : "storage_unavailable"));
        if (found.value?.found !== true) return fail(machineFailure("causation_unknown"));
      }
      // 7. Verification assessment (never a state change).
      let attempt;
      if (VERIFICATION_EVENT_TYPES.includes(envelope.eventType) && typeof lookupAttempt === "function") {
        const a = await settle(lookupAttempt, envelope.correlation.defectId, envelope.correlation.verificationAttemptId);
        if (!a.ok) return fail(machineFailure("storage_unavailable"));
        attempt = a.value;
      }
      const verification = assessVerification(screened.value.envelope, principal, attempt);
      // 8. Conditional put and decision.
      const record = buildRecord({ ...screened.value, principal, verification, observationId: observationId(), receivedAt: at });
      const decided = decidePut(record, await settle(store.putOnce, record));
      if (!decided.ok) return decided;
      return ok(Object.freeze({ disposition: "recorded", ack: decided.value, ...(decided.value.replayed ? {} : { record }) }));
    }
  });
}
