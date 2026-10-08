# SEC-001: Intake redaction, quarantine, receipt semantics and throttling limits

- Status: **Provisional** (engineering choice under the mission's "lowest-risk reversible" rule; not operator-approved)
- Date: 2026-10-08
- Requirements: VIT-API-002, VIT-API-003, VIT-API-004, VIT-API-005, VIT-API-007, VIT-API-010 (design only), VIT-NFR-004, VIT-DOM-002
- Acceptance: VIT-AC-003..009, VIT-AC-015
- Issue: #1. Status capability deferred to #12.

## Context

The baseline refused obvious credentials outright (`report-domain.mjs`) but missed AWS access keys, bearer/JWT tokens, fine-grained GitHub PATs, Slack tokens and `user:password@host` URLs, so those were stored verbatim (defect D-03). Refusing also discards a legitimate report and gives an attacker an oracle for the detector.

## Decision

1. **Redact, then quarantine.** `service/redaction.mjs` replaces detected credentials with `[redacted]` *before* domain validation, hashing, storage or logging. The record is stored with `state = disposition = "quarantined"`, in review queue partition `QUEUE#quarantined`, plus `screening.flags`/`screening.redactions` (credential **kinds** only, never values). The receipt tells the reporter that `credential-redacted` happened, so they can rotate the credential.
   - The legacy refusal inside `report-domain.mjs` still exists (owned by the typed-domain agent). It now only triggers on residue that the redactor did not remove. Handoff: retire it once the domain agent adopts the redaction contract.
2. **Quarantine triggers:** credential redaction; suspected vulnerability language (also sets `screening.escalation = "security"`, the private escalation flag for VIT-API-007); text addressed to agents ("ignore previous instructions", `curl … | sh`). A quarantined observation is never published, never auto-promoted, and only an IAM-authenticated operator can advance it (`triage-cli.mjs advance`).
3. **Refused outright:** C1 control characters and bidi overrides/isolates (D-04), on top of the existing C0 refusal. Stored text is shown to operators only through `JSON.stringify`, which escapes control characters.
4. **Idempotency:** only random v4 UUIDs (D-05). Same key with the same normalized body replays the original `{reference, receivedAt, disposition}` (HTTP 200, `replayed: true`). Same key with a different body returns `409 request_conflict` with **no** reference, timestamp or content of the stored record. The redacted body is what gets hashed, so two submissions that differ only in a redacted secret are treated as the same report.
5. **Receipt is not a capability.** `VIT-` plus 128 random bits from `crypto.randomUUID()`, uppercase hex. It can be shown to the reporter safely. The API has no read route, so the receipt grants nothing. Every non-`POST /api/v1/reports` request gets the same 404 body whether or not a reference exists (T-07). A status capability (VIT-API-010, P1) must be a **separate** high-entropy, revocable secret stored only as a hash. It is deferred to #12.
6. **Typed failures (VIT-API-005):** `service/errors.mjs` maps every failure to `{code, category, retryable, message}`, with category one of validation, abuse, throttled, temporary, permanent, unavailable. A challenge-provider *misconfiguration* (bad secret) is `unavailable`/503, not a reporter failure (D-02).

## Throttling: what is and is not enforced (honest limits)

| Control | Where | Scope | Limit |
|---|---|---|---|
| Body size | `service/http.mjs` before base64 decode and before JSON.parse | per request | 16 KiB UTF-8 bytes |
| Field sizes | `report-domain.mjs` | per field | title 120, actual/expected 1200, steps 900, URL 2000 chars |
| Challenge | Turnstile siteverify, hostname + action bound | per submission | single use (provider-documented; not verified live) |
| Stage throttle | API Gateway HTTP API `DefaultRouteSettings` | **global, all clients** | 2 rps, burst 4 |
| Concurrency | Lambda `ReservedConcurrentExecutions` | global | 4 |

**There is no per-source-IP limit.** HTTP API stage throttles are a shared token bucket, so one client that solves challenges (or a challenge-farm) can use up the quota for everyone. That is an availability risk, not a confidentiality or integrity one. A per-IP limit would need AWS WAF rate-based rules, which attach to REST APIs, CloudFront or ALB and **not** to HTTP APIs. Adding one is a cost and topology decision for the operator (see residual risk R-03 in the threat model). Storage growth is bounded only indirectly: by the global throttle times the 16 KiB cap. There is no TTL because retention is undecided (VIT-OQ-009).

## Consequences

- Reporters keep their report when they paste a secret, and the secret is not retained by Vitium. It may still exist in the reporter's browser and in TLS-terminating infrastructure memory.
- Pattern-based detection will miss novel credential formats. It is a guardrail, not DLP.
- The receipt shape gained `disposition` and `notices`. The site checks only `status === "received"` and the `reference` format, so it stays compatible.

## Reversal

Remove the `screenReport` call in `prepareReport` to go back to refuse-only behaviour. The tests in `tests/intake-canary.test.mjs` and `tests/intake-defects.test.mjs` D-03 will then fail, which is intended.
