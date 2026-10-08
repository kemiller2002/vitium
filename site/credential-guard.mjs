// Site-side credential detection (VF-004, VIT-AC-008, VIT-AC-015, VIT-NFR-004).
//
// The legacy path builds a PUBLIC GitHub URL, so credential-looking text must be
// refused before that link exists. The private path is refused too (the reporter
// is asked to remove it before sending); the service additionally redacts and
// quarantines (SEC-001), which remains the authority.
//
// The site cannot import service/ at runtime (Pages serves only site/), so these
// rules mirror service/redaction.mjs and the domain credential guard.
// tests/site-credential-parity.test.mjs proves every sample the service redacts is
// also blocked here. Keep this list a SUPERSET of the service's rules.
// Pure: no DOM, network or state.

const RULES = Object.freeze([
  { kind: "private-key", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i },
  { kind: "url-credentials", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s\/@:]+:[^\s\/@]+@/i },
  { kind: "url-secret-parameter", pattern: /[?&;](?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|code|auth)=[^\s&#;]+/i },
  { kind: "url-session-parameter", pattern: /;(?:jsessionid|phpsessid|sessionid|sid)=[^\s;\/?#]+/i },
  { kind: "authorization-header", pattern: /\b(?:Bearer|Basic|Token)\s+(?=[A-Za-z0-9._~+\/=-]*\d)[A-Za-z0-9._~+\/=-]{16,}/i },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/ },
  { kind: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { kind: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/ },
  { kind: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: "api-secret-key", pattern: /\b(?:sk|rk|pk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9_-]{18,}/ },
  { kind: "credential-assignment", pattern: /\b(?:password|passwd|passphrase|pwd|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?key|access[_ -]?token|auth[_ -]?token|aws_secret_access_key|private[_ -]?key|token|refresh[_ -]?token|session[_ -]?id)\s*[:=]\s*\S{4,}/i }
]);

const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const luhn = digits => {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};
const hasCard = text => [...text.matchAll(CARD)].some(m => {
  const digits = m[0].replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhn(digits);
});

/** Returns the kinds of credential-looking content found (never the values). */
export function credentialKinds(text) {
  if (typeof text !== "string" || !text) return Object.freeze([]);
  const kinds = RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.kind);
  if (hasCard(text)) kinds.push("payment-card");
  return Object.freeze(kinds);
}

export const looksLikeCredential = text => credentialKinds(text).length > 0;

export const CREDENTIAL_MESSAGE =
  "This looks like a password, access key, token or card number. Remove it before continuing: reports must never contain secrets.";
export const CREDENTIAL_URL_MESSAGE =
  "This page address looks like it contains a session identifier or other secret. Remove that part before continuing.";
