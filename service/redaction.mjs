// Pure screening of untrusted report text (VIT-API-002/003/007, VIT-NFR-004, VIT-AC-008).
// This is a guardrail for common accidental disclosures, NOT comprehensive DLP.
// Detected credentials are replaced before storage, logging or hashing; the record is
// then quarantined for private review. Nothing here publishes anything.

export const PLACEHOLDER = "[redacted]";

// Order matters: the most specific / enclosing patterns run first.
const secretRules = Object.freeze([
  {kind:"private-key", pattern:/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g},
  {kind:"url-credentials", pattern:/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/@:]+:[^\s\/@]+@/gi, keep:"$1"},
  // Keep the parameter name, drop "=" and value (so no residual "name=value" assignment).
  {kind:"url-secret-parameter", pattern:/([?&;](?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|code|auth))=[^\s&#;]+/gi, keep:"$1 "},
  // Servlet/PHP-style session ids carried as URL path parameters (";jsessionid=...").
  {kind:"url-session-parameter", pattern:/(;(?:jsessionid|phpsessid|sessionid|sid))=[^\s;\/?#]+/gi, keep:"$1=[redacted]", raw:true},
  // Requires a digit in the value so prose such as "Basic authentication" is not redacted.
  {kind:"authorization-header", pattern:/\b(Bearer|Basic|Token)\s+(?=[A-Za-z0-9._~+\/=-]*\d)[A-Za-z0-9._~+\/=-]{16,}/gi, keep:"$1 "},
  {kind:"jwt", pattern:/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g},
  {kind:"github-token", pattern:/\b(?:gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{20,})/g},
  {kind:"aws-access-key-id", pattern:/\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g},
  {kind:"slack-token", pattern:/\bxox[abposr]-[A-Za-z0-9-]{10,}/g},
  {kind:"api-secret-key", pattern:/\b(?:sk|rk|pk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9_-]{18,}/g},
  // Labelled assignment: keep the label, drop the separator and value so the remaining
  // text cannot be mistaken for a credential assignment by downstream checks.
  {kind:"credential-assignment", pattern:/\b(password|passwd|passphrase|pwd|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?key|access[_ -]?token|auth[_ -]?token|aws_secret_access_key|private[_ -]?key|token|refresh[_ -]?token|session[_ -]?id)\s*[:=]\s*(?!\[redacted\])\S{4,}/gi, keep:"$1 "}
]);

const luhn = digits => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};
const cardPattern = /\b\d(?:[ -]?\d){12,18}\b/g;

/** Redact one string. Returns a new string and the kinds found (no secret values). */
export function redactText(input) {
  if (typeof input !== "string" || !input) return Object.freeze({text: input, findings: Object.freeze([])});
  const found = [];
  let text = input;
  for (const {kind, pattern, keep, raw} of secretRules) {
    text = text.replace(pattern, (...match) => {
      found.push(kind);
      const expanded = keep ? keep.replace(/\$(\d)/g, (_, n) => match[Number(n)] ?? "") : "";
      return raw ? expanded : expanded + PLACEHOLDER;
    });
  }
  text = text.replace(cardPattern, candidate => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return candidate;
    found.push("payment-card");
    return PLACEHOLDER;
  });
  return Object.freeze({text, findings: Object.freeze([...new Set(found)])});
}

// C1 controls (U+0080-U+009F include 8-bit CSI) and bidirectional overrides/isolates
// (Trojan-source style display spoofing in operator consoles).
const unsafeDisplay = /[\u0080-\u009f‪-‮⁦-⁩‎‏؜]/u;
export const hasUnsafeDisplayCharacters = value => typeof value === "string" && unsafeDisplay.test(value);

const vulnerabilityLanguage = /\b(?:vulnerab\w*|exploit\w*|xss|cross[- ]site|sql[- ]?injection|csrf|ssrf|rce|remote code execution|privilege escalation|auth(?:entication|orization)? bypass|bypass(?:es|ed)? (?:auth\w*|login|security)|cve-\d{4}-\d{4,}|security (?:issue|hole|flaw|bug|problem)|data (?:leak|breach|exposure)|leak(?:s|ed|ing)? (?:data|credentials|tokens|personal))\b/i;
const agentInstruction = /\b(?:ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts)|disregard (?:the |all )?(?:previous|prior|system) (?:instructions|prompt)|you are now (?:an?|the) |system prompt|act as (?:an? )?(?:admin|administrator|developer|maintainer)|run (?:this|the following) (?:command|script)|curl [^\s]+ ?\| ?(?:ba)?sh)/i;

export const textFields = Object.freeze(["title","actual","expected","steps","pageUrl"]);

/**
 * Screen a raw (not yet normalized) report object. Pure; returns a redacted shallow copy
 * plus a classification. Unknown fields pass through untouched so the domain validator
 * can still refuse them.
 */
export function screenReport(raw) {
  const redacted = {...raw};
  const kinds = new Set();
  for (const name of textFields) {
    if (typeof raw[name] !== "string") continue;
    const {text, findings} = redactText(raw[name]);
    redacted[name] = text;
    findings.forEach(k => kinds.add(k));
  }
  const corpus = textFields.map(n => typeof redacted[n] === "string" ? redacted[n] : "").join("\n");
  const flags = [];
  if (kinds.size) flags.push("credential-redacted");
  if (vulnerabilityLanguage.test(corpus)) flags.push("possible-vulnerability");
  if (agentInstruction.test(corpus)) flags.push("agent-instruction");
  return Object.freeze({
    report: Object.freeze(redacted),
    screening: Object.freeze({
      flags: Object.freeze(flags),
      redactions: Object.freeze([...kinds].sort()),
      escalation: flags.includes("possible-vulnerability") ? "security" : null,
      disposition: flags.length ? "quarantined" : "received"
    })
  });
}
