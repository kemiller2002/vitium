# SEC-001: Intake redaction, quarantine, receipt semantics and throttling limits

- Status: **Provisional** (engineering choice under the mission's "lowest-risk reversible" rule; not operator-approved)
- Date: 2026-10-08
- Requirements: VIT-API-002, VIT-API-003, VIT-API-004, VIT-API-005, VIT-API-007, VIT-API-010 (design only), VIT-NFR-004, VIT-DOM-002
- Acceptance: VIT-AC-003..009, VIT-AC-015
- Issue: #1. Status capability deferred to #12.

## Context

The baseline refused obvious credentials outright (`report-domain.mjs`) but missed AWS access keys, bearer/JWT tokens, fine-grained GitHub PATs, Slack tokens and `user:password@host` URLs, so those were stored verbatim (defect D-03). Refusing also discards a legitimate report and gives an attacker an oracle for the detector.

## Decision

1. **Redact, then quarantine.** `service/redaction.mjs` replaces detected credentials with `[redacted]` *before* domain validation, hashing, storage or logging. The record is stored with `state = disposition = "quarantined"`, in review queue partition `QUEUE#quarantined`, plus `screening.flags`/`screening.redactions` (credential **kinds** only, never values). **Amended (fix round 1):** the receipt does *not* reveal redaction or quarantine. Exposing the screening outcome to an anonymous caller would turn the detectors into an oracle (adversarial #37). The site warns before sending (UX, VF-004), and rotation advice belongs to the privacy notice.
   - The legacy refusal inside `report-domain.mjs` still exists (owned by the typed-domain agent). It now only triggers on residue that the redactor did not remove. Handoff: retire it once the domain agent adopts the redaction contract.
2. **Quarantine triggers:** credential redaction; suspected vulnerability language (also sets `screening.escalation = "security"`, the private escalation flag for VIT-API-007); text addressed to agents ("ignore previous instructions", `curl … | sh`). A quarantined observation is never published, never auto-promoted, and only an IAM-authenticated operator can advance it (`triage-cli.mjs advance`).
3. **Refused outright:** C1 control characters and bidi overrides/isolates (D-04), on top of the existing C0 refusal. Stored text is shown to operators only through `JSON.stringify`, which escapes control characters.
4. **Idempotency:** only random v4 UUIDs (D-05). Strings are NFC-normalised before redaction, validation and hashing (VF-008). The redacted canonical body is what gets hashed, so canonically equivalent text, or text that differs only in a redacted secret, counts as the same report.
   - **Amended (fix round 1, VF-010):** the core first does a read-only `store.lookup(pk)`, a projected, strongly consistent GetItem. If the key is known and the canonical hash matches, the original `{schemaVersion, reference, receivedAt, status, replayed:true}` is returned (HTTP 200) **without a fresh challenge**. The caller already holds the random key and the full body, so nothing new is disclosed. This is what lets a lost-response retry succeed even though Turnstile tokens are single-use.
   - Same key with a different hash returns `409 request_conflict` with a catalogue-only body: no reference, timestamp or content.
   - An unknown key still requires a verified challenge before any write. A replay never writes.
   - **Amended (fix round 2, VF-023):** only *same key + same canonical hash* skips the challenge. *Same key + different hash* goes through the same challenge as a fresh key. Until a challenge is verified, both cases return the identical `403` body (`challenge_required` or `challenge_failed`), so an unchallenged caller cannot learn whether a key was used. The `409` is returned only to a verified caller. Tests: O-01, O-02, R-02, I-09, adversarial replay-path "unchallenged caller".
   - Residual: a caller who holds the key **and the exact body** gets the 200 replay. That is the intended capability of the original submitter (threat model R-11).

### Unchallenged storage reads (VF-024): accepted residual with bounding controls

The read-only `lookup` must run before the challenge, otherwise a lost-response retry, which carries a spent token or none, could never be answered (VF-010). Controls:

- **Pre-filter (implemented):** a challenge token that is *present but malformed* is refused before any I/O: wrong type, outside 12..4096 characters, or containing non-printable-ASCII. Test O-04.
- A *syntactically valid* token, real or fake, and an *absent* token still cost exactly one projected, strongly consistent `GetItem`, and no write or provider call. A syntactic check cannot tell a spent Turnstile token from a forged one, so this read cannot be removed without breaking VF-010.
- **Bounds on that read:**
  - it happens only after origin, content-type, the 24 KiB byte cap, JSON parsing and full report validation;
  - the API Gateway stage throttle (2 rps, burst 4, global) and Lambda reserved concurrency cap the rate;
  - the read is one key and projects only receipt attributes;
  - on-demand billing makes the cost about one read request unit per call.
  The worst case is therefore around 2 reads per second sustained, or about 5.2 million per month. That is an availability and cost exposure equal in size to the throttle, not a confidentiality one.
- **Operator option:** a per-IP WAF rate rule (R-03) would bound it per source.
5. **Receipt is not a capability.** `VIT-` plus 128 random bits from `crypto.randomUUID()`, uppercase hex. It can be shown to the reporter safely. The API has no read route, so the receipt grants nothing. Every non-`POST /api/v1/reports` request gets the same 404 body whether or not a reference exists (T-07). A status capability (VIT-API-010, P1) must be a **separate** high-entropy, revocable secret stored only as a hash. It is deferred to #12.
6. **Typed failures (VIT-API-005):** `service/errors.mjs` maps every failure to `{code, category, retryable, message}`, with category one of validation, abuse, throttled, temporary, permanent, unavailable. A challenge-provider *misconfiguration* (bad secret) is `unavailable`/503, not a reporter failure (D-02).

### Operator actor kind (VF-035, mission section 7 gate 4): role allow-list, fail closed

`service/triage-cli.mjs` used to label every IAM caller `authenticated-human`. That let an agent workload running under an assumed role escape the autonomous repair budget (VIT-VER-011) and the human-verifier rule (DOM-001 section 28). Decision:

- **Source of truth:** the STS `GetCallerIdentity` ARN only. A caller is `authenticated-human` **only** when that ARN is an assumed-role session (`arn:<partition>:sts::<account>:assumed-role/<RoleName>/<session>`) whose (partition, account, exact role name) matches an entry in `VITIUM_HUMAN_OPERATOR_ROLE_ARNS`. That variable is a comma-separated list of IAM role ARNs (`arn:aws:iam::<account>:role/[path/]<RoleName>`). Assumed-role ARNs drop the IAM path, and role names are unique per account, so the path is ignored in matching. Names are matched case-sensitively, exactly as STS returns them.
- **Fail closed:** in every other case the caller is `agent`. That includes an unset or empty list (there are **no default entries**), IAM users, root, federated users, other accounts or partitions, unlisted or look-alike role names, and malformed ARNs. An agent may submit, fail or mark inconclusive within the budget. It cannot record a passing result (`human_verifier_required`), cannot record an escalation, and is refused with `escalation_required` once the budget is exhausted. A malformed allow-list entry (including `*`) refuses the whole command (exit 2) before any AWS call, so a typo can never widen access.
- **Never trusted:** CLI flags and command-body values. Unknown flags such as `--provenance=` are ignored, and the domain refuses a body provenance that disagrees with the trusted context.
- **Why not a session tag:** the instruction allowed a required session tag such as `vitium:actor-kind=human` as an alternative. I chose the role allow-list because `GetCallerIdentity` does not return session tags, so the CLI cannot verify one. Operators may still *additionally* require `aws:PrincipalTag/vitium:actor-kind = human` in the human role's trust or permissions policy as defence in depth.
- **Residual:** anyone who can assume an allow-listed role *is* treated as a human. The role trust policy is therefore the real control: it should require SSO with MFA and must not be assumable by CI or agent workloads. Owner decision: OPERATOR-DECISIONS row proposed in the intake round-5 handoff.
- **Tests:** `tests/intake-operator-identity.test.mjs` OI-01..OI-06. The adversarial round-4 test for VF-035 now passes without its todo marker.

## Throttling: what is and is not enforced (honest limits)

| Control | Where | Scope | Limit |
|---|---|---|---|
| Body size | `service/http.mjs` (from `service/limits.mjs`), before base64 decode and before JSON.parse | per request | 24 KiB UTF-8 bytes (raised from 16 KiB in fix round 1: every field at maximum in 3-byte characters, plus a 4096-character token, measured above 16 KiB) |
| Field sizes | `report-domain.mjs` | per field | title 120, actual/expected 1200, steps 900, URL 2000 chars |
| Challenge | Turnstile siteverify, hostname + action bound | per submission | single use (provider-documented; not verified live) |
| Stage throttle | API Gateway HTTP API `DefaultRouteSettings` | **global, all clients** | 2 rps, burst 4 |
| Concurrency | Lambda `ReservedConcurrentExecutions` | global | 4 |

**There is no per-source-IP limit.** HTTP API stage throttles are a shared token bucket, so one client that solves challenges (or a challenge-farm) can use up the quota for everyone. That is an availability risk, not a confidentiality or integrity one. A per-IP limit would need AWS WAF rate-based rules, which attach to REST APIs, CloudFront or ALB and **not** to HTTP APIs. Adding one is a cost and topology decision for the operator (see residual risk R-03 in the threat model). Storage growth is bounded only indirectly: by the global throttle times the 24 KiB cap. There is no TTL because retention is undecided (VIT-OQ-009).

## Consequences

- Reporters keep their report when they paste a secret, and the secret is not retained by Vitium. It may still exist in the reporter's browser and in TLS-terminating infrastructure memory.
- Pattern-based detection will miss novel credential formats. It is a guardrail, not DLP.
- The receipt shape is exactly `{schemaVersion, reference, receivedAt, status, replayed}`. It is identical for received and quarantined observations.

## Reversal

Remove the `screenReport` call in `prepareReport` to go back to refuse-only behaviour. The tests in `tests/intake-canary.test.mjs` and `tests/intake-defects.test.mjs` D-03 will then fail, which is intended.
