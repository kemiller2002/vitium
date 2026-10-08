// Versioned machine-observation envelope (VIT-INT-013, VIT-INT-017, VIT-DOM-005).
// Pure validation and normalization only. Candidate contract: not a deployed API.
// Mirrored by schemas/machine-observation.schema.json; tests keep both aligned.
import { containsCredential, sha256 } from "./report-domain.mjs";

export const machineSchemaVersion = "1.0";
export const eventTypes = Object.freeze([
  "observation.detected", "verification.failed", "verification.passed",
  "verification.inconclusive", "governance.violation"
]);
export const verificationEventTypes = Object.freeze(eventTypes.filter(type => type.startsWith("verification.")));
export const sourceSystems = Object.freeze(["praxis", "ordo", "conditor", "dokimos", "tutela", "aegis", "ci", "agent"]);
export const environments = Object.freeze(["ci", "local", "staging", "production"]);
export const categories = Object.freeze([
  "test-failure", "build-failure", "packaging-failure", "deployment-verification-failure",
  "quality-violation", "mutation-weakness", "security-finding", "runtime-fault",
  "install-failure", "governance-violation", "work-execution-failure", "agent-suspicion",
  "verification-result"
]);
export const confidences = Object.freeze(["observed", "suspected"]);
export const evidenceKinds = Object.freeze(["test-result", "check-run", "build-log", "artifact", "sarif", "diagnostic", "attestation"]);
// Producers may never claim a triage outcome; classification belongs to Vitium triage.
export const producerClassification = "untriaged";
// Vitium-minted causation markers. Events caused by Vitium output are echoes (VIT-INT-015).
export const vitiumCausationPrefix = "vitium:";
export const limits = Object.freeze({ maxBytes: 32_768, maxEvidence: 20, maxEventAgeMs: 7 * 24 * 3600_000, maxClockSkewMs: 5 * 60_000 });

export class ObservationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ObservationError";
    this.code = code;
    this.status = status;
  }
}
const refuse = message => { throw new ObservationError("invalid_observation", 400, message); };

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, name, allowed) => {
  if (!isObject(value)) refuse(name + " must be an object.");
  // Attacker-chosen key names are truncated so errors never echo large payload fragments.
  Object.keys(value).forEach(key => { if (!allowed.includes(key)) refuse("Unexpected field " + name + "." + key.slice(0, 40).replace(/[^\w.-]/g, "?") + "."); });
  return value;
};
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const text = (value, name, max, { optional = false, pattern } = {}) => {
  if (value === undefined || value === null) return optional ? null : refuse(name + " is required.");
  if (typeof value !== "string") refuse(name + " must be text.");
  const clean = value.trim();
  if (!clean) return optional ? null : refuse(name + " is required.");
  if (clean.length > max) refuse(name + " is too long.");
  if (controlCharacters.test(clean)) refuse(name + " contains invalid characters.");
  if (pattern && !pattern.test(clean)) refuse(name + " has an invalid format.");
  return clean;
};
const oneOf = (value, name, allowed) => allowed.includes(value) ? value : refuse("Unsupported " + name + ".");

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repository = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{0,199}$/;
const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const digest = /^[0-9a-f]{64}$/;
const defectId = /^VIT-[A-Za-z0-9]{4,64}$/;
// RFC 3339 with an explicit zone. .NET's System.Text.Json writes DateTimeOffset as "+00:00",
// so offsets are accepted and stored canonically in UTC ("Z").
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
// Evidence must point at a public artifact host, never an IP literal or internal name (SSRF/metadata).
const internalHost = host => /^\[|^\d{1,3}(?:\.\d{1,3}){3}$|^localhost$|\.(?:local|internal|localhost|lan|home|corp)$/i.test(host) || !host.includes(".");
const secretQueryName = /token|sig|signature|secret|password|credential|auth|key|code/i;

const decodeURIComponentSafe = value => { try { return decodeURIComponent(value); } catch { return value; } };
const stringsOf = value => typeof value === "string" ? [value]
  : value && typeof value === "object" ? Object.values(value).flatMap(stringsOf) : [];

function evidenceItem(raw, index) {
  const item = exactKeys(raw, "evidence[" + index + "]", ["kind", "uri", "sha256"]);
  const uri = text(item.uri, "evidence uri", 2000);
  let url;
  try { url = new URL(uri); } catch { refuse("Evidence uri must be an absolute URL."); }
  if (url.protocol !== "https:") refuse("Evidence uri must use HTTPS.");
  if (url.username || url.password) refuse("Evidence uri must not embed credentials.");
  if ([...url.searchParams.keys()].some(name => secretQueryName.test(name))) refuse("Evidence uri must not carry credential parameters.");
  if (url.hash) refuse("Evidence uri must not carry a fragment.");
  if (internalHost(url.hostname)) refuse("Evidence uri must reference a public artifact host.");
  if (containsCredential(uri) || containsCredential(decodeURIComponentSafe(uri))) refuse("Evidence uri appears to contain a credential.");
  return Object.freeze({
    kind: oneOf(item.kind, "evidence kind", evidenceKinds),
    uri: url.href,
    sha256: text(item.sha256, "evidence sha256", 64, { pattern: digest })
  });
}

const normalizeEventTime = (raw, now) => {
  const observedAt = text(raw, "observedAt", 40, { pattern: isoInstant });
  const at = Date.parse(observedAt);
  if (Number.isNaN(at)) refuse("observedAt is not a valid instant.");
  const current = Date.parse(now);
  if (at > current + limits.maxClockSkewMs) refuse("observedAt is in the future.");
  if (at < current - limits.maxEventAgeMs) throw new ObservationError("stale_observation", 422, "The observation is older than the accepted delivery window.");
  return new Date(at).toISOString();
};

/** Validates an untrusted envelope. `now` is an ISO instant supplied by the effect boundary. */
export function normalizeMachineObservation(raw, now) {
  const envelope = exactKeys(raw, "observation", ["schemaVersion", "eventId", "eventType", "source", "subject", "finding", "evidence", "correlation", "observedAt"]);
  if (envelope.schemaVersion !== machineSchemaVersion) throw new ObservationError("unsupported_version", 422, "Unsupported observation schema version.");
  const eventType = oneOf(envelope.eventType, "eventType", eventTypes);
  const source = exactKeys(envelope.source, "source", ["system", "repository", "installationId", "version"]);
  const subject = exactKeys(envelope.subject, "subject", ["workItemId", "commit", "runId", "checkId", "environment"]);
  const finding = exactKeys(envelope.finding, "finding", ["category", "summary", "expected", "observed", "classification", "confidence"]);
  const correlation = exactKeys(envelope.correlation ?? {}, "correlation", ["defectId", "verificationAttemptId", "causationEventId"]);
  if (!Array.isArray(envelope.evidence) || envelope.evidence.length < 1 || envelope.evidence.length > limits.maxEvidence) {
    refuse("Between 1 and " + limits.maxEvidence + " evidence references are required.");
  }
  if (finding.classification !== producerClassification) refuse("Producers cannot classify observations; send classification \"untriaged\".");
  const normalized = {
    schemaVersion: machineSchemaVersion,
    eventId: text(envelope.eventId, "eventId", 36, { pattern: uuid }).toLowerCase(),
    eventType,
    source: Object.freeze({
      system: oneOf(source.system, "source system", sourceSystems),
      repository: text(source.repository, "source repository", 140, { pattern: repository }),
      installationId: text(source.installationId, "source installationId", 200, { pattern: identifier }),
      version: text(source.version, "source version", 100, { pattern: identifier })
    }),
    subject: Object.freeze({
      workItemId: text(subject.workItemId, "workItemId", 200, { optional: true, pattern: identifier }),
      commit: text(subject.commit, "commit", 64, { pattern: commit }),
      runId: text(subject.runId, "runId", 200, { pattern: identifier }),
      checkId: text(subject.checkId, "checkId", 200, { pattern: identifier }),
      environment: oneOf(subject.environment, "environment", environments)
    }),
    finding: Object.freeze({
      category: oneOf(finding.category, "category", categories),
      summary: text(finding.summary, "summary", 200),
      expected: text(finding.expected, "expected", 1200),
      observed: text(finding.observed, "observed", 1200),
      classification: producerClassification,
      confidence: oneOf(finding.confidence, "confidence", confidences)
    }),
    evidence: Object.freeze(envelope.evidence.map(evidenceItem)),
    correlation: Object.freeze({
      defectId: text(correlation.defectId, "defectId", 70, { optional: true, pattern: defectId }),
      verificationAttemptId: text(correlation.verificationAttemptId, "verificationAttemptId", 200, { optional: true, pattern: identifier }),
      causationEventId: text(correlation.causationEventId, "causationEventId", 80, { optional: true, pattern: identifier })
    }),
    observedAt: normalizeEventTime(envelope.observedAt, now)
  };
  if (new Set(normalized.evidence.map(item => item.uri)).size !== normalized.evidence.length) refuse("Evidence references must be unique.");
  if (verificationEventTypes.includes(eventType) &&
      (!normalized.correlation.defectId || !normalized.correlation.verificationAttemptId)) {
    refuse("Verification results must reference a defect and verification attempt.");
  }
  if (eventType === "governance.violation" && normalized.finding.category !== "governance-violation") {
    refuse("Governance violations must use the governance-violation category.");
  }
  // Every accepted string, identifiers included, is scanned; not only the prose fields.
  if (stringsOf(normalized).some(containsCredential)) refuse("The observation appears to contain a credential. Send a redacted evidence reference instead.");
  return Object.freeze(normalized);
}

// Candidate duplicate key (not an automatic merge): repository + check + category + normalized signature.
// Commit and run are excluded so the same failure on distinct commits correlates as occurrences.
export const normalizeSignature = value => value.toLowerCase()
  .replace(/\b[0-9a-f]{7,64}\b/g, "#")
  .replace(/\d+/g, "0")
  .replace(/\s+/g, " ")
  .trim();
export const fingerprint = observation => sha256([
  observation.source.repository, observation.subject.checkId,
  observation.finding.category, normalizeSignature(observation.finding.observed)
].join("\n"));
export const occurrenceKey = observation => [
  observation.subject.commit, observation.subject.runId, observation.subject.checkId
].join("#");
export const isVitiumEcho = observation =>
  typeof observation?.correlation?.causationEventId === "string" &&
  observation.correlation.causationEventId.startsWith(vitiumCausationPrefix);
// Security findings and Tutela output are routed privately and never to public issues.
export const visibilityFor = observation =>
  observation.source.system === "tutela" || observation.finding.category === "security-finding"
    ? "restricted-security" : "private";
// Provenance class (VIT-DOM-005); derived from the authenticated principal, not the payload.
export const provenanceFor = principal => principal.system === "agent" ? "agent" : principal.system === "ci" ? "ci" : "application";

/** Groups stored machine observations by candidate fingerprint without collapsing occurrences. */
export const groupOccurrences = observations => Object.freeze(Object.fromEntries(
  Object.entries(observations.reduce((groups, item) => ({
    ...groups, [item.fingerprint]: [...(groups[item.fingerprint] || []), item]
  }), {})).map(([key, items]) => [key, Object.freeze({
    candidateDuplicateKey: key,
    occurrences: Object.freeze([...new Map(items.map(item => [item.occurrenceKey, item])).values()]
      .map(item => Object.freeze({ occurrenceKey: item.occurrenceKey, eventId: item.envelope.eventId, commit: item.envelope.subject.commit, runId: item.envelope.subject.runId }))),
    deliveries: items.length
  })])
));

// Verification result submitted by EchelonFoundry.Vitium.Client to POST /api/v1/verification-results.
// It is evidence for a proposal, never a state change; see verification-proposals.mjs.
export const verificationResultOutcomes = Object.freeze(["passed", "failed", "inconclusive"]);
export function normalizeVerificationResult(raw, now) {
  const result = exactKeys(raw, "verificationResult", ["schemaVersion", "eventId", "defectId", "attemptId", "candidateRevision", "workItemId", "expectedDefectRevision", "outcome", "source", "evidence", "observedAt"]);
  if (result.schemaVersion !== machineSchemaVersion) throw new ObservationError("unsupported_version", 422, "Unsupported verification result schema version.");
  const source = exactKeys(result.source, "source", ["system", "repository", "installationId", "version"]);
  if (!Array.isArray(result.evidence) || result.evidence.length < 1 || result.evidence.length > limits.maxEvidence) {
    refuse("Between 1 and " + limits.maxEvidence + " evidence references are required.");
  }
  if (!Number.isSafeInteger(result.expectedDefectRevision) || result.expectedDefectRevision < 0) {
    refuse("expectedDefectRevision must be a non-negative integer.");
  }
  const outcome = oneOf(result.outcome, "outcome", verificationResultOutcomes);
  const normalized = {
    schemaVersion: machineSchemaVersion,
    eventId: text(result.eventId, "eventId", 36, { pattern: uuid }).toLowerCase(),
    eventType: "verification." + outcome,
    source: Object.freeze({
      system: oneOf(source.system, "source system", sourceSystems),
      repository: text(source.repository, "source repository", 140, { pattern: repository }),
      installationId: text(source.installationId, "source installationId", 200, { pattern: identifier }),
      version: text(source.version, "source version", 100, { pattern: identifier })
    }),
    subject: Object.freeze({
      workItemId: text(result.workItemId, "workItemId", 200, { optional: true, pattern: identifier }),
      commit: text(result.candidateRevision, "candidateRevision", 64, { pattern: commit })
    }),
    correlation: Object.freeze({
      defectId: text(result.defectId, "defectId", 70, { pattern: defectId }),
      verificationAttemptId: text(result.attemptId, "attemptId", 200, { pattern: identifier }),
      causationEventId: null
    }),
    expectedDefectRevision: result.expectedDefectRevision,
    evidence: Object.freeze(result.evidence.map(evidenceItem)),
    observedAt: normalizeEventTime(result.observedAt, now)
  };
  if (new Set(normalized.evidence.map(item => item.uri)).size !== normalized.evidence.length) refuse("Evidence references must be unique.");
  if (stringsOf(normalized).some(containsCredential)) refuse("The verification result appears to contain a credential.");
  return Object.freeze(normalized);
}
