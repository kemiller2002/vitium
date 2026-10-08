import { IntakeError, normalizeReport, makeReference, payloadHash, assertIdempotencyKey } from "./report-domain.mjs";

/**
 * Pure effect boundary: store.putOnce(item) -> { created: boolean, existing?: item }
 * and verifyChallenge(token) -> Promise<boolean>. No global network or storage calls.
 */
export function makeIntake({store, verifyChallenge, now = () => new Date().toISOString(), reference = makeReference}) {
  if (!store?.putOnce || typeof verifyChallenge !== "function") throw new TypeError("Intake requires durable store and challenge verifier.");
  return {
    async submit(raw, {idempotencyKey, challengeToken}) {
      const report = normalizeReport(raw);
      const key = assertIdempotencyKey(idempotencyKey);
      if (typeof challengeToken !== "string" || challengeToken.length < 12 || challengeToken.length > 4096) {
        throw new IntakeError("challenge_required",403,"Please complete the verification challenge.");
      }
      let verified = false;
      try { verified = await verifyChallenge(challengeToken); }
      catch { throw new IntakeError("challenge_unavailable",503,"Verification is temporarily unavailable. Please retry."); }
      if (verified !== true) throw new IntakeError("challenge_failed",403,"Verification failed. Please try again.");
      const hash = payloadHash(report);
      const item = {
        pk: "REQUEST#" + key,
        reference: reference(),
        payloadHash: hash,
        report,
        source: "public-api",
        visibility: "private",
        kind: "observation",
        status: "received",
        receivedAt: now()
      };
      let result;
      try { result = await store.putOnce(item); }
      catch { throw new IntakeError("storage_unavailable",503,"The report could not be saved. Please retry."); }
      if (!result || typeof result.created !== "boolean") {
        throw new IntakeError("storage_unavailable",503,"The report could not be saved. Please retry.");
      }
      const accepted = result.created ? item : result.existing;
      if (!accepted || accepted.payloadHash !== hash) {
        throw new IntakeError("request_conflict",409,"This request identifier was used for different report content. Please start a new submission.");
      }
      if (typeof accepted.reference !== "string" || !accepted.receivedAt) {
        throw new IntakeError("storage_unavailable",503,"The report could not be confirmed. Please retry.");
      }
      return Object.freeze({
        schemaVersion: "1.0",
        reference: accepted.reference,
        receivedAt: accepted.receivedAt,
        status: "received",
        replayed: !result.created
      });
    }
  };
}
