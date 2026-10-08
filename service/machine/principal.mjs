// Workload identity port and pure authorization (VIT-INT-016). DESIGN + ENFORCEMENT ONLY:
// there is no real verifier, credential, issuer or audience in this repository.
//
// A VerifiedPrincipal can be produced ONLY by `makePrincipalVerifier(verifyWorkloadIdentity)`
// wrapping an injected effect (e.g. a future GitHub Actions OIDC exchange performed at a
// protected server boundary). Every principal minted there is registered in a module-private
// WeakSet; `authorize` refuses any object not in that set. Request data can never become a
// principal: a structurally identical object literal, a JSON round-trip, a spread copy or a
// structuredClone of a real principal are all different objects and are refused.
//
// The principal is deep-frozen, so its scopes cannot be widened after verification.
import { ENUMS, PATTERNS } from "./contract.mjs";

const ok = value => Object.freeze({ ok: true, value });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const IDENT = new RegExp(PATTERNS.identifier, "u");
const REPOSITORY = new RegExp(PATTERNS.repository, "u");

// Module-private brand. Not exported, not reachable from any returned value.
const minted = new WeakSet();

export const AUTH_ERROR_CODES = Object.freeze([
  "unauthenticated", "authentication_unavailable", "credential_in_body", "invalid_principal",
  "principal_expired", "identity_mismatch", "repository_not_in_scope", "environment_not_in_scope",
  "event_type_not_in_scope"
]);

const listOf = (value, check, max) => Array.isArray(value) && value.length >= 1 && value.length <= max && value.every(check)
  && new Set(value).size === value.length;

/** Pure shape check of what the verifier effect returned. Never trusts it blindly either. */
function checkClaims(claims) {
  if (!isObject(claims)) return fail("invalid_principal", "Verifier returned no principal.");
  const allowed = ["principalId", "system", "repositories", "environments", "eventTypes", "expiresAt"];
  if (Object.keys(claims).some(k => !allowed.includes(k))) return fail("invalid_principal", "Verifier returned unexpected claims.");
  if (typeof claims.principalId !== "string" || !IDENT.test(claims.principalId)) return fail("invalid_principal", "principalId invalid.");
  if (!ENUMS.system.includes(claims.system)) return fail("invalid_principal", "system invalid.");
  if (!listOf(claims.repositories, r => typeof r === "string" && REPOSITORY.test(r), 50)) return fail("invalid_principal", "repositories invalid.");
  if (!listOf(claims.environments, e => ENUMS.environment.includes(e), ENUMS.environment.length)) return fail("invalid_principal", "environments invalid.");
  if (!listOf(claims.eventTypes, e => ENUMS.eventType.includes(e), ENUMS.eventType.length)) return fail("invalid_principal", "eventTypes invalid.");
  if (typeof claims.expiresAt !== "string" || !Number.isFinite(Date.parse(claims.expiresAt))) return fail("invalid_principal", "expiresAt invalid.");
  return ok(claims);
}

/**
 * Wrap the injected verification effect. The ONLY way to obtain a VerifiedPrincipal.
 *   verifyWorkloadIdentity(credential) -> Promise<Result<claims, "invalid"|"unavailable">>
 * The credential comes from the transport (e.g. Authorization header), never from the body.
 * Returns verify(credential) -> Promise<Result<VerifiedPrincipal, authError>>.
 */
export function makePrincipalVerifier(verifyWorkloadIdentity) {
  if (typeof verifyWorkloadIdentity !== "function") throw new TypeError("A workload identity verifier effect is required.");
  return async function verify(credential) {
    if (typeof credential !== "string" || credential.length === 0 || credential.length > 8192) return fail("unauthenticated", "A workload credential is required.");
    let outcome;
    try { outcome = await verifyWorkloadIdentity(credential); } catch { return fail("authentication_unavailable", "Identity verification is unavailable."); }
    if (!isObject(outcome) || typeof outcome.ok !== "boolean") return fail("authentication_unavailable", "Identity verification is unavailable.");
    if (!outcome.ok) return outcome.error === "unavailable"
      ? fail("authentication_unavailable", "Identity verification is unavailable.")
      : fail("unauthenticated", "The workload credential was not accepted.");
    const checked = checkClaims(outcome.value);
    if (!checked.ok) return checked;
    const c = checked.value;
    const principal = Object.freeze({
      principalId: c.principalId, system: c.system,
      repositories: Object.freeze([...c.repositories]), environments: Object.freeze([...c.environments]),
      eventTypes: Object.freeze([...c.eventTypes]), expiresAt: c.expiresAt
    });
    minted.add(principal);
    return ok(principal);
  };
}

/** True only for principals minted by a verifier in this module instance. */
export const isVerifiedPrincipal = value => isObject(value) && minted.has(value);

/**
 * Pure authorization of a validated envelope against a verified principal at time `now`.
 * Refuses: no/forged principal, expiry, source.system or source.repository disagreeing
 * with the principal (forged identity), and repository/environment/eventType outside scope.
 */
export function authorize(principal, envelope, now) {
  if (principal === undefined || principal === null) return fail("unauthenticated", "A verified workload principal is required.");
  if (!isVerifiedPrincipal(principal)) return fail("invalid_principal", "Principal was not produced by the identity verifier.");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || Date.parse(principal.expiresAt) <= nowMs) return fail("principal_expired", "The workload credential has expired.");
  if (envelope.source.system !== principal.system) return fail("identity_mismatch", "source.system does not match the authenticated principal.");
  if (!principal.repositories.includes(envelope.source.repository)) return fail("repository_not_in_scope", "The principal may not report for this repository.");
  if (!principal.environments.includes(envelope.subject.environment)) return fail("environment_not_in_scope", "The principal may not report for this environment.");
  if (!principal.eventTypes.includes(envelope.eventType)) return fail("event_type_not_in_scope", "The principal may not send this event type.");
  return ok(Object.freeze({ principalId: principal.principalId, system: principal.system }));
}
