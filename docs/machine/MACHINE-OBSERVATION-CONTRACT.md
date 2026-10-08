# Vitium machine-observation contract v1

- Status: **proposed contract. Not deployed. No route serves it.** No producer sends it.
- Requirements: VIT-INT-013 (P0), with groundwork for VIT-INT-014..018 (P1), VIT-DOM-005, VIT-VER-009/011.
- Acceptance: VIT-AC-032 and VIT-AC-035 (Vitium core level only), VIT-AC-036 (the no-auto-closure part).
- Decision: [MACH-001](../decisions/MACH-001-machine-observation-contract.md) (proposed).
- Canonical requirements: [`VITIUM-BUILD-SYSTEM-REPORTING.md`](../requirements/VITIUM-BUILD-SYSTEM-REPORTING.md). Issue #14.

## 1. What exists and what does not

| Exists in this repository (pure code + tests) | Does NOT exist (not deployed, not built) |
|---|---|
| Versioned JSON Schema `schemas/machine/observation-envelope.v1.schema.json` | `POST /api/v1/observations` or any other machine route |
| Runtime validator `service/machine/contract.mjs`, with parity to the schema proven by tests | Any change to `service/http.mjs`, `aws-handler.mjs` or `infra/aws/template.yaml` |
| Workload-identity **port** and pure authorization `service/machine/principal.mjs` | A real verifier: no OIDC issuer, audience, JWKS, trust policy or credential |
| Pure intake core `service/machine/observation-core.mjs` | A machine-observation table, IAM role or storage adapter |
| Producer outbox policy `service/machine/outbox.mjs` | A background outbox worker, dead-letter queue or alerting |
| In-memory reference store `service/machine/memory-store.mjs` (tests only) | Producer adapters in Praxis, Ordo, Conditor, Dokimos, Tutela, Aegis or CI |
| Examples and shared cases under `schemas/machine/` | Conditor-managed bindings; any upstream pull request |
| Tests `tests/machine-*.test.mjs` (in `npm test`) | Ordo transition authority, and any automatic lifecycle effect |

Nobody may describe the machine API, the producer adapters or Ordo authority as **deployed** until there is genuine end-to-end integration evidence (mission §7).

## 2. Why this is separate from public Turnstile intake

| | Public intake `POST /api/v1/reports` | Machine observations (proposed) |
|---|---|---|
| Caller | Anonymous human in a browser | Echelon workload (CI job, Praxis, Dokimos, ...) |
| Proof | Turnstile challenge (proves "probably a human", nothing about identity) | Short-lived, attested workload identity, verified at a protected server boundary |
| Authorization | None (anyone may report) | Scope-bound: system, repositories, environments, event types |
| Idempotency | Caller-chosen random v4 key per submission | Producer-chosen random v4 `eventId` per logical event |
| Receipt | Opaque reference for a human | Machine ack, scoped to the storing principal: `{schemaVersion, eventId, principalId, observationId, receivedAt, status, replayed}` |
| Content | Free text (redacted, quarantined) | Structured, bounded envelope; evidence references with digests, no log bodies |

A Turnstile token cannot authenticate a machine, and an anonymous route cannot bind a caller to a repository. If machines used the public route, any internet caller could claim to be "praxis". So the two boundaries share only the redaction rules (`service/redaction.mjs`) and the conditional-put storage pattern.

## 3. Wire envelope (v1)

The schema is closed (`additionalProperties: false` everywhere). Every string has a pattern and `maxLength`, every array has `maxItems`, and enum sets are fixed. The constants live in `service/machine/contract.mjs`. `tests/machine-contract.test.mjs` fails if the schema and the runtime differ, and replays 135 shared cases through both ajv and the runtime, including the inherited-name keys `constructor`, `toString`, `__proto__` and others at every object level (VF-029: membership is checked with own-property tests only).

| Field | Rule |
|---|---|
| `schemaVersion` | `"1.0"` exactly. Anything else gets `unsupported_version`. |
| `eventId` | Lowercase random v4 UUID. This is the delivery idempotency key. |
| `eventType` | `observation.detected`, `verification.failed`, `verification.passed`, `verification.inconclusive`, `governance.violation` (VIT-INT-017). No type names a lifecycle state. |
| `source.system` | `praxis`, `ordo`, `conditor`, `dokimos`, `tutela`, `aegis`, `ci`, `agent`, `vitium`. **It is a claim only** and must equal the verified principal's system. `vitium` exists so that echoes can be recognised; such events are never stored. |
| `source.repository` | `owner/name` in GitHub syntax. Must be inside the principal's repository scope. |
| `source.installationId`, `source.version` | Bounded identifiers. They must come from the qualified installation, not from placeholders. |
| `subject.commit` | 40 lowercase hex characters. Short SHAs, `HEAD` and branch names are refused. |
| `subject.runId`, `checkId` | Bounded identifiers. `runAttempt` is an optional integer from 1 to 1000. `workItemId` is an identifier or `null`. |
| `subject.environment` | `ci`, `development`, `staging`, `production`. Must be inside the principal's environment scope. |
| `finding.category` | One of 16 categories (see contract.mjs). `governance-violation` is used if and only if `eventType` is `governance.violation`. |
| `finding.summary` / `expected` / `observed` | Single line: no control characters (including newline and tab), no zero-width or bidi characters, no leading or trailing space. Length limits are 200, 1000 and 1000 code points. |
| `finding.classification` | **Only `"untriaged"`.** Producers cannot classify, confirm or resolve. |
| `finding.confidence` | `observed` or `suspected`. |
| `evidence[]` | 1 to 10 unique items `{kind, uri, sha256}`. `uri` must be `https://`, use a DNS host with an alphabetic TLD (so no IP literals, no `localhost`, no userinfo), and carry **no query string or fragment**. `sha256` is 64 lowercase hex characters. |
| `correlation` | `defectId` (`DEF-` digits or null), `verificationAttemptId`, `causationEventId` (v4 UUID or null), and an optional `originMarker` (`vitium/...`, the echo marker). Verification events must carry both `defectId` and `verificationAttemptId`. |
| `observedAt` | ISO-8601 instant with an explicit offset. Calendar ranges are checked at runtime. That is the only documented schema/runtime divergence, and a test pins it. |

Note: the sample in the requirements document carries a 65-character `sha256`. The contract refuses it (it is not a SHA-256), and a shared case records this.

Examples: `schemas/machine/examples/*.json`. These are a CI observation, a Dokimos failed, passed and inconclusive verification, an Ordo governance violation, and a Tutela security rule. Their identifiers and digests are illustrative, not real runs.

Body limit: 16 KiB in UTF-8, measured before `JSON.parse`.

## 4. Authentication and authorization model (VIT-INT-016)

```
 producer workload --(transport credential, e.g. Authorization header; NEVER the body)--> protected boundary
     verifyWorkloadIdentity(credential)   <- injected effect (future: GitHub Actions OIDC exchange / short-lived machine credential)
         -> claims {principalId, system, repositories[], environments[], eventTypes[], expiresAt}
     makePrincipalVerifier -> VerifiedPrincipal (frozen, registered in a module-private WeakSet)
     authorize(principal, envelope, now)  <- pure
```

- `VerifiedPrincipal` objects are created only inside `makePrincipalVerifier`. `authorize` and the intake refuse anything not registered in the module-private WeakSet. Tests prove the refusal for literal, JSON round-trip, spread, `structuredClone` and prototype copies. Request data can never become a principal.
- The verifier's claims are themselves validated: closed claim set, non-empty unique scopes, no wildcards, known systems, environments and event types, and a parseable expiry.
- The intake refuses (typed, before any write) when:
  - there is no principal, or the principal is forged;
  - the principal has expired, or `now` is unknown (fail closed);
  - `source.system` or `source.repository` disagrees with the principal (`identity_mismatch`, `repository_not_in_scope`);
  - the environment or event type is outside the principal's scope.
- Any credential-named field anywhere in the body (`token`, `credential`, `authorization`, `principal`, `id_token`, ...) is refused with `credential_in_body`. The value is never echoed.
- An unauthenticated or forged caller gets an authentication refusal **before** any parse or validation feedback, so the schema is not a free oracle for that caller.

Audit and rotation details (who issues credentials, lifetime, audience, revocation) are operator decisions (MACH-001).

## 5. Processing order and decisions

`observation-core.makeMachineIntake({store, now, observationId, lookupAttempt?}).submit({principal, body})`:

1. Principal present and minted, else `unauthenticated` / `invalid_principal`.
2. Bounded parse, else `payload_too_large` / `invalid_json`.
3. Credential-field scan, then closed-schema validation: `credential_in_body`, `invalid_envelope` (with JSON `path`), `unsupported_version`, or `unsafe_evidence`.
4. `authorize` (section 4).
5. **Echo suppression, bound to the verified principal** (VF-030):
   - if the **verified** principal's system is `vitium`, the result is `{disposition: "echo-suppressed"}`. Nothing is stored and no ack id is returned, so there is no recursive self-reporting (requirements item 8);
   - if any other principal presents an `originMarker`, the result is `spoofed_echo_marker` (403). The refusal is visible, never a silent drop, so a buggy or compromised adapter cannot hide real failures.
6. **Screening:**
   - log or stack-trace content in finding text is refused (`log_dump_refused`);
   - evidence URIs that the shared redactor flags (for example a token-shaped path segment) are refused (`unsafe_evidence`);
   - credentials in finding text are replaced with `[redacted]` by `service/redaction.mjs` **before** hashing or storage, and the observation is stored `quarantined`;
   - vulnerability language raises the private-security escalation.
7. **Causal ordering:** if `causationEventId` is set and not yet recorded, the result is `causation_unknown` (409, retryable). Nothing is written. The producer retries later.
8. **Verification assessment** (section 7).
9. **Conditional put** (port semantics match intake's `attribute_not_exists(pk)`):
   - created: ack with `replayed: false`;
   - same `eventId`, same principal and same canonical hash: **the same ack** (`replayed: true`) and no second record (requirements item 1);
   - same `eventId` from a **different principal**: `event_conflict` (409), whether or not the body matches. eventIds are global, not namespaced per principal (MACH-001 3a, VF-031). Nothing about the original is disclosed;
   - same `eventId`, same principal, different hash: `event_conflict` (409). The body is catalogue-only;
   - a verification attempt (`defectId` + `verificationAttemptId`) that already has a **conclusive** (failed/passed) result: `stale_event` if the new event is older, otherwise `attempt_conflict`. The first conclusive result is never overwritten. `verification.inconclusive` never claims the attempt, so any number of inconclusive runs and one later conclusive re-run are accepted (VF-032, DOM-001 §19);
   - store unavailable or throwing: `storage_unavailable` (503, retryable). Store throttled: `throttled` (429).

The canonical hash is SHA-256 over the canonical (sorted-key) JSON of the **redacted** envelope. Key order and whitespace therefore never change idempotency.

### Fingerprint: a duplicate *candidate*, never a merge

`FP-sha256(repository ∥ checkId ∥ category ∥ normalize(summary) ∥ normalize(observed))`. Normalization lowercases the text and replaces UUIDs, hex and `0x` values, and numbers with placeholders. Commit, run, attempt and environment are excluded on purpose. Two runs that hit the same failure are stored as **two occurrence records** with the same `candidate.fingerprint` and `mergeDecision: null` (requirements item 2). Merging is a human or triage decision.

### Stored record (private)

`kind: "machine-observation"`, `classification: "untriaged"`, `state: "received" | "quarantined"`, `revision: 0`, empty history. The record also holds the redacted envelope, the verified principal (`principalId`, `system`), `provenance` derived from the **verified** system (`ci`, `agent`, otherwise `application`; VIT-DOM-005, never invented), the occurrence, the candidate, routing, screening (kinds only) and the verification assessment.

## 6. Security-classified routing

A finding is routed `visibility: "private-security"`, `securityClassified: true`, `publicProjection: "never"` when any of these hold:
- the category is `security-rule`;
- the verified source is Tutela;
- the shared redactor's vulnerability-language detector fires.

`mayProjectPublicly(record, approval)` refuses such records whatever approval is offered. Other machine observations are `private`, and any future public projection needs a recorded human review.

## 7. No automatic lifecycle effects (VIT-AC-032/036, VIT-VER-009/011)

- The core does not import or call `service/lifecycle.mjs` or `service/triage.mjs`, and a test checks this. It never produces `confirmed`, `in-progress`, `resolved` or `closed`.
- `verification.failed` and `verification.passed` can at most attach a **proposal**: `{kind: "proposed-transition", status: "proposed", applied: false, expectedFrom: "awaiting-verification", suggestedTarget, candidateRevision, verificationAttemptId, runId, reportedVerifier, evidence, sourceEventId}`.
  - The proposal is deliberately **not executable**. It has no `to`, actor, role, `expectedRevision`, reason or timestamp.
  - A human or Ordo-guarded path must build its own lifecycle command, with its own role, evidence and revision checks.
- No proposal is produced, and the reason is recorded in `verification.withheldReason`, when:
  - the verifier principal **is the attempt author** (`self-certification` flag);
  - there is no attempt-author port (independence cannot be shown, so the core fails closed);
  - the attempt is unknown;
  - the confidence is `suspected`;
  - the event is `verification.inconclusive`, or the category is `infrastructure-error` or `flaky-test`.
- A plain green build is a `verification.passed` without independent attempt context, so it yields nothing. A malformed verification (missing attempt or defect id) or a producer-asserted classification is refused by the schema.

## 8. Producer outbox policy (VIT-INT-015)

`service/machine/outbox.mjs` contains pure functions for the future shared producer binding:

- `classifyDelivery`:
  - 2xx **with a machine ack for exactly this `eventId`** (`schemaVersion: "1.0"`, `status: "recorded"`, and the entry's `principalId` when known): delivered;
  - any other 2xx (captive portal, proxy page, `{}`, another event's ack): retry, recorded as `lastError {kind: "protocol-error", code: "ack_mismatch"}` (VF-033);
  - 429, 408, 5xx, timeout, network error, `causation_unknown`: retry;
  - 401 `principal_expired`: re-authenticate;
  - other 4xx and 409 conflicts: permanent, so the entry goes to dead-letter for repair.
- `nextDelivery(entry, now, policy, outcome?, jitter?)`:
  - bounded exponential backoff with injected "equal jitter", capped at `maxDelayMs`;
  - `Retry-After` is honoured up to `maxRetryAfterMs`;
  - `maxAttempts` leads to dead-letter `retry-exhausted`, and `expiresAfterMs` leads to dead-letter `expired`;
  - a dead-lettered entry keeps its last error. Entries are never silently dropped.
- `reportWithDelivery(buildResult, entries, {reportingMandatory})`:
  - returns the **same** `buildResult` object untouched, beside delivery telemetry (delivered, pending, dead-lettered, failures);
  - if repository policy makes reporting mandatory, a **separate** `vitium-reporting` gate is added. The test status is never overwritten.
- `orderByCausation`: a cause is always sent before its effect. Events in a causation cycle are withheld for repair.

`DEFAULT_POLICY` values (2 s base, 5 min cap, 8 attempts, 24 h expiry) are provisional engineering defaults, **not an SLA**.

## 9. Error codes

| Code | Status | Retryable | Meaning |
|---|---|---|---|
| `payload_too_large` | 413 | no | Body over 16 KiB |
| `invalid_json` | 400 | no | Body is not JSON text |
| `invalid_envelope` | 400 | no | Schema violation (`path` given) |
| `unsupported_version` | 400 | no | `schemaVersion` is not `1.0` |
| `credential_in_body` | 400 | no | Credential-named field present |
| `unsafe_evidence` | 400 | no | Evidence URI is not credential-free https without query or fragment |
| `log_dump_refused` | 400 | no | Log or stack-trace content in finding text |
| `unauthenticated` / `invalid_principal` | 401 | no | No principal, or a forged one |
| `principal_expired` | 401 | yes | Get a fresh workload credential |
| `identity_mismatch` | 403 | no | `source.system` differs from the principal |
| `repository_not_in_scope` / `environment_not_in_scope` / `event_type_not_in_scope` | 403 | no | Outside the principal's scope |
| `spoofed_echo_marker` | 403 | no | A non-Vitium principal sent a Vitium origin marker |
| `event_conflict` | 409 | no | Same `eventId` with different content, or from a different principal |
| `stale_event` / `attempt_conflict` | 409 | no | Attempt result already recorded (older / newer event) |
| `causation_unknown` | 409 | yes | Cause not recorded yet |
| `throttled` | 429 | yes | Back off |
| `authentication_unavailable` / `storage_unavailable` | 503 | yes | Dependency down; nothing written |

HTTP statuses are the proposed mapping for a future endpoint.

## 10. Producer adapter rollout plan (P1, each step gated)

1. **Vitium first** (this change): the contract, the pure core, the outbox policy and the tests.
2. **Operator decisions** (MACH-001): the identity provider and exchange (proposed: GitHub Actions OIDC exchanged at a protected boundary for a short-lived, scope-bound Vitium credential); hosting and storage of the authenticated endpoint; retention; and the audit sink.
3. **Authenticated endpoint** in Vitium behind its own boundary. It needs a separate work item, operator approval, a Fides/Arca compatibility review and an independent verification agent. It must not reuse the public route.
4. **Shared producer binding** (one typed adapter that wraps envelope building and the outbox policy), distributed as a **Conditor-managed binding** (VIT-INT-018). There are no one-off curl scripts and no long-lived embedded secrets.
5. **Two pilot producers, end to end:** one Praxis producer and one CI/Dokimos producer. **Each needs its own approved upstream PR** in that repository, plus compatibility verification. Vitium agents do not modify upstream repositories.
6. Only after both pilots pass end to end: Ordo (governance violations), Conditor (install and upgrade failures), Tutela (private-security), Aegis (redacted fault references) and other agents.

## 11. How to verify

```
node --test tests/machine-*.test.mjs     # contract parity, auth, core, outbox
npm test                                  # whole suite (machine tests included)
```

Mutation evidence for the critical guards (forged principal, identity and scope checks, expiry, eventId idempotency, no-auto-transition, echo suppression, security routing, stale ordering, outbox invariants, untriaged-only classification) is recorded in the integrator's mission record. It is not self-certified here.
