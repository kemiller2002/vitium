// Authenticated machine-observation intake (VIT-INT-013/015/016, VIT-AC-032/035).
// Separate from the anonymous Turnstile route in intake.mjs. Effects are injected:
//   verifyWorkloadToken(token) -> Promise<verified claims>   (signature, issuer, audience)
//   store.putOnce(item)        -> { created: boolean, existing?: item }
// Machine events are stored as untriaged observations. Nothing here confirms, resolves,
// closes or transitions a defect; see verification-proposals.mjs for guarded proposals.
import {
  ObservationError, normalizeMachineObservation, normalizeVerificationResult, fingerprint, occurrenceKey,
  isVitiumEcho, visibilityFor, provenanceFor
} from "./machine-observation.mjs";
import { AuthorizationError, principalFromClaims, authorizeObservation, authorizeVerificationResult } from "./machine-auth.mjs";
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

const principalSummary = principal => Object.freeze({ subject: principal.subject, system: principal.system, credentialId: principal.credentialId });
const baseItem = (envelope, principal, receivedAt) => ({
  pk: "MOBS#" + envelope.eventId,
  envelope,
  payloadHash: payloadHash(envelope),
  provenance: provenanceFor(principal),
  principal: principalSummary(principal),
  classification: "untriaged",
  state: "received",
  revision: 0,
  history: Object.freeze([]),
  reviewQueuePk: "QUEUE#machine",
  receivedAt
});
const observationItem = (observation, principal, receivedAt) => Object.freeze({
  ...baseItem(observation, principal, receivedAt),
  kind: "machine-observation",
  fingerprint: fingerprint(observation),
  occurrenceKey: occurrenceKey(observation),
  visibility: visibilityFor(observation)
});
const verificationItem = (result, principal, receivedAt) => Object.freeze({
  ...baseItem(result, principal, receivedAt),
  kind: "machine-verification-result",
  fingerprint: null,
  occurrenceKey: null,
  visibility: "private"
});

// Stable, opaque reference derived from the idempotency key, so replays return the same receipt.
export const machineReference = eventId => "VIT-M" + eventId.replaceAll("-", "").toUpperCase();
// Matches EchelonFoundry.Vitium.Contracts.Receipt (schemaVersion, reference, acceptedAt, status, replayed).
const receipt = (eventId, acceptedAt, status, replayed, extra = {}) => Object.freeze({
  schemaVersion: "1.0", reference: machineReference(eventId), acceptedAt, status, replayed, eventId, ...extra
});

const routes = Object.freeze({
  observation: Object.freeze({ normalize: normalizeMachineObservation, authorize: authorizeObservation, toItem: observationItem, noun: "observation" }),
  verification: Object.freeze({ normalize: normalizeVerificationResult, authorize: authorizeVerificationResult, toItem: verificationItem, noun: "verification result" })
});

export function makeMachineIntake({ store, verifyWorkloadToken, bindings, now = () => new Date().toISOString() }) {
  if (!store?.putOnce || typeof verifyWorkloadToken !== "function" || !Array.isArray(bindings)) {
    throw new TypeError("Machine intake requires a durable store, workload verifier and identity bindings.");
  }
  const ingest = route => async (raw, { authorization, idempotencyKey }) => {
    const token = bearer(authorization);
    const receivedAt = now();
    let claims;
    try { claims = await verifyWorkloadToken(token); }
    catch (error) {
      if (error instanceof AuthorizationError) rethrowTyped(error);
      fail("identity_unavailable", 503, "Workload identity verification is unavailable. Retry later.");
    }
    if (!claims) fail("unauthenticated", 401, "The workload credential was not accepted.");
    let principal, envelope;
    try {
      principal = principalFromClaims(claims, bindings, receivedAt);
      envelope = route.normalize(raw, receivedAt);
      route.authorize(principal, envelope);
    } catch (error) { rethrowTyped(error); }
    // The F# client sends eventId as Idempotency-Key; a disagreeing header is a client defect, not a new event.
    if (idempotencyKey !== undefined && String(idempotencyKey).trim().toLowerCase() !== envelope.eventId) {
      fail("idempotency_mismatch", 400, "Idempotency-Key must equal the eventId.");
    }
    // Echo suppression: never ingest events caused by Vitium's own output (no feedback loop).
    if (isVitiumEcho(envelope)) return receipt(envelope.eventId, receivedAt, "suppressed", false, { reason: "vitium-echo" });
    const item = route.toItem(envelope, principal, receivedAt);
    let result;
    try { result = await store.putOnce(item); }
    catch { fail("storage_unavailable", 503, "The " + route.noun + " could not be stored. Retry with the same eventId."); }
    if (!result || typeof result.created !== "boolean") fail("storage_unavailable", 503, "The " + route.noun + " could not be confirmed. Retry with the same eventId.");
    const stored = result.created ? item : result.existing;
    if (!stored || stored.payloadHash !== item.payloadHash) {
      fail("event_conflict", 409, "This eventId was already used for a different event.");
    }
    if (stored.principal?.subject !== principal.subject) {
      fail("event_conflict", 409, "This eventId was already delivered by a different workload identity.");
    }
    return receipt(stored.envelope.eventId, stored.receivedAt, "received", !result.created, {
      classification: "untriaged", candidateDuplicateKey: stored.fingerprint
    });
  };
  return Object.freeze({
    submit: ingest(routes.observation),
    submitVerificationResult: ingest(routes.verification)
  });
}
