// Pure credential-pattern scanner (VIT-NFR-004, VIT-AC-015).
// No I/O here: callers pass text in and receive immutable findings out.
// Findings never echo the matched secret; only a short, masked preview.

export const SECRET_PATTERNS = Object.freeze([
  { id: "github-classic-token", description: "GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)", regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: "github-fine-grained-pat", description: "GitHub fine-grained PAT", regex: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { id: "aws-access-key-id", description: "AWS access key id (AKIA/ASIA)", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "aws-secret-access-key", description: "AWS secret access key assignment", regex: /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/gi },
  { id: "private-key-block", description: "PEM private key header", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: "turnstile-key-value", description: "Cloudflare Turnstile key-shaped value (0x4AAAAAAA...)", regex: /\b0x4AAAAAAA[A-Za-z0-9_-]{10,}\b/g },
  { id: "bearer-token", description: "Bearer credential literal", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g },
  { id: "url-embedded-credentials", description: "URL with embedded user:password", regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`<>]+:[^\s/@"'`<>]+@[^\s/"'`<>]+/gi },
  { id: "slack-token", description: "Slack token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g }
]);

const mask = value => value.length <= 8 ? "****" : `${value.slice(0, 4)}…(${value.length} chars)`;

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// scanText :: (string, string, patterns?) -> ReadonlyArray<Finding>
export const scanText = (path, text, patterns = SECRET_PATTERNS) =>
  Object.freeze(patterns.flatMap(({ id, regex }) =>
    [...text.matchAll(new RegExp(regex.source, regex.flags))].map(m => Object.freeze({
      path, patternId: id, line: lineOf(text, m.index), preview: mask(m[0])
    }))));

// An allowlist entry must name the exact file and pattern and give a reason.
export const isAllowlisted = (allowlist, finding) =>
  allowlist.some(a => a.path === finding.path && a.patternId === finding.patternId);

// partitionFindings :: (findings, allowlist) -> { blocked, allowed, staleAllowlist }
export const partitionFindings = (findings, allowlist) => Object.freeze({
  blocked: findings.filter(f => !isAllowlisted(allowlist, f)),
  allowed: findings.filter(f => isAllowlisted(allowlist, f)),
  staleAllowlist: allowlist.filter(a => !findings.some(f => f.path === a.path && f.patternId === a.patternId))
});

// Text-like files only; binaries are reported separately by callers.
export const SCANNABLE_EXTENSIONS = Object.freeze([
  ".mjs", ".js", ".cjs", ".ts", ".json", ".yml", ".yaml", ".md", ".html", ".css",
  ".txt", ".sh", ".fs", ".fsx", ".fsproj", ".xml", ".toml", ".env", ".ini", ".cfg", ""
]);

export const isScannablePath = path => {
  const base = path.split("/").pop();
  const dot = base.lastIndexOf(".");
  const ext = dot <= 0 ? "" : base.slice(dot).toLowerCase();
  return SCANNABLE_EXTENSIONS.includes(ext);
};

export const EXCLUDED_DIRS = Object.freeze([".git", "node_modules", ".aws-sam"]);
