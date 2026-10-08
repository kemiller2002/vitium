// Private intake core (VIT-API-001..005/007, VIT-DOM-002).
//
// Shape: small pure decision functions + one orchestration function whose ONLY effects
// are the injected ports below. Expected failures are returned as typed Result values
// (see errors.mjs); nothing here throws for reporter, provider or storage failures.
//
// Ports (all injected, none global):
//   store.putOnce(item)       -> Result<{created:true} | {created:false, existing:{reference,payloadHash,receivedAt,disposition?}}, "unavailable"|"throttled">
//                                (a legacy plain {created,...} value is also accepted; a rejected promise is "unavailable")
//   store.lookup(pk)          -> Result<{found:false} | {found:true, existing:{reference,payloadHash,receivedAt}}, "unavailable"|"throttled">
//                                OPTIONAL read-only port. When present, a retry of a stored request is answered
//                                WITHOUT a fresh challenge (VF-010); without it, every request needs a challenge.
//   verifyChallenge(token)    -> Result<boolean, "unavailable"|"misconfigured">   (legacy plain boolean accepted)
//   now()                     -> ISO-8601 string
//   reference()               -> opaque high-entropy receipt reference
//
// Ordering guarantees (each guarded by a mutation-tested test):
//   validate -> [lookup: known key? same canonical hash -> original receipt | different -> 409]
//            -> verify challenge -> persist -> receipt.
//   Nothing is ever WRITTEN without a verified challenge; no receipt without a confirmed durable
//   write (or a durable record found by lookup). A replay discloses only what the caller already
//   proved it has: the full canonical body under the same random key.
import { IntakeError, normalizeReport, makeReference, payloadHash, assertIdempotencyKey } from "./report-domain.mjs";
import { ok, fail, intakeFailure } from "./errors.mjs";
import { INTAKE_LIMITS } from "./limits.mjs";
import { screenReport, redactText, hasUnsafeDisplayCharacters, textFields } from "./redaction.mjs";

const RANDOM_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUEUE = Object.freeze({received:"QUEUE#pending", quarantined:"QUEUE#quarantined"});

/** Pure: idempotency key -> Result<storage key hash>. Only random (v4) UUIDs are accepted. */
export function parseIdempotencyKey(key) {
  if (typeof key !== "string" || !RANDOM_UUID_V4.test(key)) return fail(intakeFailure("invalid_request_id"));
  try { return ok(assertIdempotencyKey(key)); }
  catch { return fail(intakeFailure("invalid_request_id")); }
}

/** Pure: shape check for the one-time challenge token (never stored, never logged). */
export const checkChallengeShape = token =>
  typeof token === "string" && token.length >= INTAKE_LIMITS.minChallengeTokenChars &&
  token.length <= INTAKE_LIMITS.maxChallengeTokenChars && /^[\x21-\x7e]+$/.test(token)
    ? ok(token) : fail(intakeFailure("challenge_required"));

/**
 * Pure: raw untrusted object -> Result<{report, screening}>.
 * Credentials are redacted BEFORE domain validation so they are never stored, hashed or
 * echoed; the domain validator (report-domain.mjs) then enforces fields, sizes and URLs.
 */
// Mandatory free-text fields that render as nothing (only whitespace / format characters
// such as zero-width space, ZWJ, word joiner, BOM) are refused like empty ones.
const MANDATORY_TEXT = Object.freeze(["title","actual","expected"]);
const visiblyEmpty = value => typeof value === "string" && value.replace(/[\s\p{Cf}]/gu, "") === "";

/** Pure: NFC-normalize every string field so canonically equivalent text is one payload (VF-008). */
export function canonicalizeRaw(raw) {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v.normalize("NFC") : v]));
}

export function prepareReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail(intakeFailure("invalid_input","Report must be an object."));
  for (const name of textFields) {
    const value = input[name];
    if (typeof value === "string" && !value.isWellFormed()) return fail(intakeFailure("invalid_input","The report contains invalid characters."));
    if (hasUnsafeDisplayCharacters(value)) return fail(intakeFailure("invalid_input","The report contains invalid characters."));
  }
  for (const name of MANDATORY_TEXT) {
    if (visiblyEmpty(input[name])) return fail(intakeFailure("invalid_input","Please fill in every required field."));
  }
  const raw = canonicalizeRaw(input);
  // pageUrl is excluded from pre-redaction: the domain validator strips userinfo, query and
  // fragment itself; the remaining path is screened after normalization below.
  const {report: screenedRaw, screening} = screenReport({...raw, pageUrl: undefined});
  let normalized;
  try { normalized = normalizeReport({...screenedRaw, pageUrl: raw.pageUrl}); }
  catch (error) {
    if (error instanceof IntakeError) return fail(intakeFailure("invalid_input", error.message));
    return fail(intakeFailure("invalid_input"));
  }
  const path = redactText(normalized.pageUrl);
  const redactions = [...new Set([...screening.redactions, ...path.findings])].sort();
  const flags = redactions.length && !screening.flags.includes("credential-redacted")
    ? ["credential-redacted", ...screening.flags] : [...screening.flags];
  return ok(Object.freeze({
    report: Object.freeze({...normalized, pageUrl: path.text}),
    screening: Object.freeze({
      flags: Object.freeze(flags),
      redactions: Object.freeze(redactions),
      escalation: screening.escalation,
      disposition: flags.length ? "quarantined" : "received"
    })
  }));
}

/** Pure: the private observation record. Never contains the challenge token or raw key. */
export function buildObservation({storageKey, report, screening, reference, receivedAt}) {
  return Object.freeze({
    pk: "REQUEST#" + storageKey,
    reference,
    payloadHash: payloadHash(report),
    report,
    source: "public-api",
    visibility: "private",
    kind: "observation",
    status: "received",
    state: screening.disposition,
    disposition: screening.disposition,
    screening,
    revision: 0,
    history: Object.freeze([]),
    reviewQueuePk: QUEUE[screening.disposition],
    receivedAt
  });
}

/**
 * Pure: the reporter-facing receipt. Acknowledges durable storage only; grants no access.
 * Deliberately identical for received and quarantined observations: exposing the screening
 * outcome would give anonymous callers an oracle for the secret/vulnerability detectors.
 */
export const receiptFor = ({reference, receivedAt}, replayed) => Object.freeze({
  schemaVersion: INTAKE_LIMITS.schemaVersion,
  reference,
  receivedAt,
  status: "received",
  replayed
});

/** Pure: interpret a store outcome for a candidate item. */
export function decideReceipt(item, outcome) {
  if (!outcome.ok) return fail(intakeFailure(outcome.error === "throttled" ? "throttled" : "storage_unavailable"));
  const value = outcome.value;
  if (value.created === true) return ok(receiptFor(item, false));
  const existing = value.existing;
  if (value.created !== false || !existing || typeof existing.payloadHash !== "string") {
    return fail(intakeFailure("storage_unavailable"));
  }
  // Same key + different content: refuse without revealing anything about the stored report.
  if (existing.payloadHash !== item.payloadHash) return fail(intakeFailure("request_conflict"));
  if (typeof existing.reference !== "string" || typeof existing.receivedAt !== "string") {
    return fail(intakeFailure("storage_unavailable"));
  }
  return ok(receiptFor(existing, true));
}

// Effect boundary normalizers: any effect misbehaviour becomes a typed value.
const asResult = value => value && typeof value === "object" && typeof value.ok === "boolean" ? value : null;
async function settleChallenge(verify, token) {
  let value;
  try { value = await verify(token); } catch { return fail("unavailable"); }
  const result = asResult(value);
  if (result) return result.ok ? ok(result.value === true) : fail(result.error === "misconfigured" ? "misconfigured" : "unavailable");
  return ok(value === true);
}
async function settleLookup(store, pk) {
  if (typeof store.lookup !== "function") return ok({found:false});
  let value;
  try { value = await store.lookup(pk); } catch { return fail("unavailable"); }
  const result = asResult(value);
  if (!result) return fail("unavailable");
  if (!result.ok) return result;
  const v = result.value;
  if (v?.found === false) return ok({found:false});
  if (v?.found === true && v.existing && typeof v.existing === "object") return ok(v);
  return fail("unavailable");
}
async function settleStore(store, item) {
  let value;
  try { value = await store.putOnce(item); } catch { return fail("unavailable"); }
  const result = asResult(value);
  if (result) return result;
  return value && typeof value.created === "boolean" ? ok(value) : fail("unavailable");
}

export function makeIntake({store, verifyChallenge, now = () => new Date().toISOString(), reference = makeReference}) {
  if (!store?.putOnce || typeof verifyChallenge !== "function") throw new TypeError("Intake requires durable store and challenge verifier.");
  return Object.freeze({
    /** -> Promise<Result<receipt, failure>> plus non-sensitive screening metadata for logging. */
    async submit(raw, {idempotencyKey, challengeToken}) {
      const prepared = prepareReport(raw);
      if (!prepared.ok) return prepared;
      const storageKey = parseIdempotencyKey(idempotencyKey);
      if (!storageKey.ok) return storageKey;
      const pk = "REQUEST#" + storageKey.value;
      const hash = payloadHash(prepared.value.report);

      // Idempotent replay (VF-010): a known key is answered from durable state, before and
      // without the challenge. Different canonical content under the key is a 409 that
      // reveals nothing stored. Nothing is written on this path.
      const known = await settleLookup(store, pk);
      if (!known.ok) return fail(intakeFailure(known.error === "throttled" ? "throttled" : "storage_unavailable"));
      if (known.value.found) return decideReceipt({payloadHash: hash}, ok({created:false, existing:known.value.existing}));

      const token = checkChallengeShape(challengeToken);
      if (!token.ok) return token;

      const challenge = await settleChallenge(verifyChallenge, token.value);
      if (!challenge.ok) return fail(intakeFailure(challenge.error === "misconfigured" ? "service_unavailable" : "challenge_unavailable"));
      if (challenge.value !== true) return fail(intakeFailure("challenge_failed"));

      const item = buildObservation({
        storageKey: storageKey.value, ...prepared.value,
        reference: reference(), receivedAt: now()
      });
      const decided = decideReceipt(item, await settleStore(store, item));
      return decided.ok
        ? Object.freeze({...decided, screening: decided.value.replayed ? undefined : item.screening})
        : decided;
    }
  });
}
