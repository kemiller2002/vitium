// Authenticated machine-observation intake (VIT-INT-013/015/016, VIT-AC-032/035).
// Separate from the anonymous Turnstile route in intake.mjs. Effects are injected:
//   verifyWorkloadToken(token) -> Promise<verified claims>   (signature, issuer, audience)
//   store.putOnce(item)        -> { created: boolean, existing?: item }
// Machine events are stored as untriaged observations. Nothing here confirms, resolves,
// closes or transitions a defect; see verification-proposals.mjs for guarded proposals.
import {
  ObservationError, normalizeMachineObservation, fingerprint, occurrenceKey,
  isVitiumEcho, visibilityFor, provenanceFor
} from "./machine-observation.mjs";
import { AuthorizationError, principalFromClaims, authorizeObservation } from "./machine-auth.mjs";
import { sha256 } from "./report-domain.mjs";

export class MachineIntakeError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "MachineIntakeError";
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status, message) => { throw new MachineIntakeError(code, status, message); };
const bearer = header => {
  const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9._~+/-]{16,8192}=*)$/.exec(header.trim()) : null;
  return match ? match[1] : fail("unauthenticated", 401, "A workload bearer credential is required.");
};
// Domain errors from pure modules surface with their own code and status.
const rethrowTyped = error => {
  if (error instanceof ObservationError || error instanceof AuthorizationError) fail(error.code, error.status, error.message);
  throw error;
};
const payloadHash = observation => sha256(JSON.stringify(observation));

const toItem = (observation, principal, receivedAt) => Object.freeze({
  pk: "MOBS#" + observation.eventId,
  kind: "machine-observation",
  envelope: observation,
  payloadHash: payloadHash(observation),
  fingerprint: fingerprint(observation),
  occurrenceKey: occurrenceKey(observation),
  provenance: provenanceFor(principal),
  principal: Object.freeze({ subject: principal.subject, system: principal.system, credentialId: principal.credentialId }),
  visibility: visibilityFor(observation),
  classification: "untriaged",
  state: "received",
  revision: 0,
  history: Object.freeze([]),
  reviewQueuePk: "QUEUE#machine",
  receivedAt
});

const acknowledgment = (item, replayed) => Object.freeze({
  schemaVersion: "1.0",
  eventId: item.envelope.eventId,
  status: "received",
  classification: "untriaged",
  candidateDuplicateKey: item.fingerprint,
  receivedAt: item.receivedAt,
  replayed
});

export function makeMachineIntake({ store, verifyWorkloadToken, bindings, now = () => new Date().toISOString() }) {
  if (!store?.putOnce || typeof verifyWorkloadToken !== "function" || !Array.isArray(bindings)) {
    throw new TypeError("Machine intake requires a durable store, workload verifier and identity bindings.");
  }
  return Object.freeze({
    async submit(raw, { authorization }) {
      const token = bearer(authorization);
      const receivedAt = now();
      let claims;
      try { claims = await verifyWorkloadToken(token); }
      catch (error) {
        if (error instanceof AuthorizationError) rethrowTyped(error);
        fail("identity_unavailable", 503, "Workload identity verification is unavailable. Retry later.");
      }
      if (!claims) fail("unauthenticated", 401, "The workload credential was not accepted.");
      let principal, observation;
      try {
        principal = principalFromClaims(claims, bindings, receivedAt);
        observation = normalizeMachineObservation(raw, receivedAt);
        authorizeObservation(principal, observation);
      } catch (error) { rethrowTyped(error); }
      // Echo suppression: never ingest events caused by Vitium's own output (no feedback loop).
      if (isVitiumEcho(observation)) {
        return Object.freeze({ schemaVersion: "1.0", eventId: observation.eventId, status: "suppressed", reason: "vitium-echo", replayed: false });
      }
      const item = toItem(observation, principal, receivedAt);
      let result;
      try { result = await store.putOnce(item); }
      catch { fail("storage_unavailable", 503, "The observation could not be stored. Retry with the same eventId."); }
      if (!result || typeof result.created !== "boolean") fail("storage_unavailable", 503, "The observation could not be confirmed. Retry with the same eventId.");
      if (result.created) return acknowledgment(item, false);
      const existing = result.existing;
      if (!existing || existing.payloadHash !== item.payloadHash) {
        fail("event_conflict", 409, "This eventId was already used for a different observation.");
      }
      if (existing.principal?.subject !== principal.subject) {
        fail("event_conflict", 409, "This eventId was already delivered by a different workload identity.");
      }
      return acknowledgment(existing, true);
    }
  });
}
