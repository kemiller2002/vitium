// Cloudflare Turnstile siteverify adapter for the challenge port. fetch, the secret loader
// and the timeout are injected. Returns Result<boolean, "unavailable"|"misconfigured">,
// never throws, never returns or logs the token, secret or provider body.
//
// Single use: Cloudflare rejects a second siteverify of the same token with
// "timeout-or-duplicate" (documented provider behaviour; NOT verified live here). The
// intake core verifies BEFORE any write, so a replayed token cannot persist anything.
import { ok, fail } from "../errors.mjs";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MISCONFIGURED = new Set(["missing-input-secret","invalid-input-secret","bad-request"]);
const PROVIDER_FAULT = new Set(["internal-error"]);

/** Pure: interpret a siteverify JSON body. */
export function interpretSiteverify(data, {expectedHostname, expectedAction}) {
  if (!data || typeof data !== "object") return fail("unavailable");
  const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
  if (codes.some(c => MISCONFIGURED.has(c))) return fail("misconfigured");
  if (codes.some(c => PROVIDER_FAULT.has(c))) return fail("unavailable");
  return ok(data.success === true && data.hostname === expectedHostname && data.action === expectedAction);
}

export function makeTurnstileVerifier({fetch, loadSecret, expectedHostname, expectedAction = "vitium-intake", timeoutMs = 5000}) {
  if (typeof fetch !== "function" || typeof loadSecret !== "function" || !expectedHostname) {
    throw new TypeError("Turnstile verifier requires fetch, secret loader and expected hostname.");
  }
  return async function verifyChallenge(token) {
    const secret = await loadSecret().then(ok, () => fail("unavailable"));
    if (!secret.ok) return secret;
    if (typeof secret.value !== "string" || !secret.value) return fail("misconfigured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(SITEVERIFY_URL, {
        method:"POST", body:new URLSearchParams({secret:secret.value, response:token}), signal:controller.signal
      });
      if (!resp?.ok) return fail("unavailable");
      return interpretSiteverify(await resp.json(), {expectedHostname, expectedAction});
    } catch {
      return fail("unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
}
