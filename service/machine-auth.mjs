// Workload authorization for machine observations (VIT-INT-016).
// Token signature/issuer verification is an injected effect (e.g. a GitHub Actions OIDC
// verifier at a protected server boundary). This module only maps already-verified claims
// onto server-side bindings and checks scope. Caller payload fields are never proof of identity.
import { sourceSystems, environments, eventTypes } from "./machine-observation.mjs";

export const maxCredentialLifetimeMs = 15 * 60_000;
const clockSkewMs = 60_000;

export class AuthorizationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = status;
  }
}
const deny = message => { throw new AuthorizationError("scope_denied", 403, message); };
const unauthenticated = message => { throw new AuthorizationError("unauthenticated", 401, message); };
const nonEmptyStrings = value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string" && item.length > 0);

/**
 * Server-side binding registry entry: which verified workload subject may speak as which
 * producer, for which repositories, environments and event types. Configuration, not payload.
 */
export function defineBinding(binding) {
  const valid = binding && typeof binding.subject === "string" && binding.subject.length > 0 &&
    sourceSystems.includes(binding.system) && nonEmptyStrings(binding.repositories) &&
    nonEmptyStrings(binding.environments) && binding.environments.every(env => environments.includes(env)) &&
    nonEmptyStrings(binding.eventTypes) && binding.eventTypes.every(type => eventTypes.includes(type));
  if (!valid) throw new TypeError("Invalid machine identity binding.");
  return Object.freeze({
    subject: binding.subject, system: binding.system,
    repositories: Object.freeze([...binding.repositories]),
    environments: Object.freeze([...binding.environments]),
    eventTypes: Object.freeze([...binding.eventTypes])
  });
}

/**
 * Maps verified workload claims ({sub, iat, exp, jti} in seconds, as in OIDC) to a principal.
 * Unbound subjects are rejected even when the token itself is valid.
 */
export function principalFromClaims(claims, bindings, now) {
  if (!claims || typeof claims.sub !== "string" || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) ||
      typeof claims.jti !== "string" || !claims.jti) {
    unauthenticated("The workload credential is incomplete.");
  }
  const current = Date.parse(now);
  const issuedAt = claims.iat * 1000;
  const expiresAt = claims.exp * 1000;
  if (expiresAt <= current) unauthenticated("The workload credential has expired.");
  if (issuedAt > current + clockSkewMs) unauthenticated("The workload credential is not yet valid.");
  if (expiresAt - issuedAt > maxCredentialLifetimeMs) unauthenticated("Only short-lived workload credentials are accepted.");
  const binding = bindings.find(entry => entry.subject === claims.sub);
  if (!binding) deny("This workload identity is not bound to Vitium machine intake.");
  return Object.freeze({ ...binding, credentialId: claims.jti, expiresAt: new Date(expiresAt).toISOString() });
}

/** Checks an authenticated principal against a normalized observation. Pure. */
export function authorizeObservation(principal, observation) {
  if (principal.system !== observation.source.system) deny("The credential is not authorized for the claimed source system.");
  if (!principal.repositories.includes(observation.source.repository)) deny("The credential is not authorized for this repository.");
  if (!principal.environments.includes(observation.subject.environment)) deny("The credential is not authorized for this environment.");
  if (!principal.eventTypes.includes(observation.eventType)) deny("The credential is not authorized for this event type.");
  return principal;
}
