---
id: MACH-001
title: Authenticated machine-observation contract, workload identity and producer rollout
status: proposed
date: 2026-10-08
owner: vitium (build-system integrations agent, mission VIT-P0-2026-10-08)
requirements: [VIT-INT-013, VIT-INT-014, VIT-INT-015, VIT-INT-016, VIT-INT-017, VIT-INT-018, VIT-DOM-005, VIT-VER-009, VIT-VER-011]
acceptance: [VIT-AC-032, VIT-AC-035, VIT-AC-036]
issue: "#14"
---

# MACH-001: Authenticated machine-observation contract

**Status: proposed.** These are provisional, reversible engineering choices. They are not operator-approved and not deployed. Nothing here creates a route, credential, cloud resource or upstream change. The contract is described in [MACHINE-OBSERVATION-CONTRACT.md](../machine/MACHINE-OBSERVATION-CONTRACT.md).

## Context

Echelon build and engineering systems (Praxis, Ordo, Conditor, Dokimos, Tutela, Aegis, CI and agents) must be able to report evidence-backed observations to Vitium without a human filing a GitHub issue (#14, `VITIUM-BUILD-SYSTEM-REPORTING.md`). The only existing intake is the anonymous public `POST /api/v1/reports`, protected by Turnstile. It proves neither who is calling nor which repository the caller may speak for.

## Decision (provisional)

1. **A separate, versioned envelope**, `schemas/machine/observation-envelope.v1.schema.json`:
   - closed and bounded, with five distinct event kinds;
   - producers may only send `classification: "untriaged"`;
   - evidence is digest-bearing https references with no query string or fragment, never log bodies;
   - the runtime validator (`service/machine/contract.mjs`) and the schema are proven equivalent by a shared case corpus.
2. **Identity comes from a verified workload principal, never from the body.**
   - `VerifiedPrincipal` is produced only by an injected `verifyWorkloadIdentity` effect and branded in a module-private WeakSet.
   - Authorization is pure. It refuses forged principals, expiry, `source.system`/`source.repository` that disagree with the principal, and repositories, environments or event types outside scope.
   - Credentials in the body are refused.
3. **Idempotency:**
   - the producer-chosen v4 `eventId` and the SHA-256 of the canonical redacted envelope decide the outcome: same pair returns the same ack; same id with a different hash is a conflict;
   - a verification attempt accepts one recorded result, and older events are refused as stale;
   - the fingerprint is only a **duplicate candidate**, and each run stays its own occurrence.
4. **No automatic lifecycle effect.**
   - Machine events are stored as untriaged private observations.
   - An independent verification result may carry a non-executable *proposal*. Self-certification, a missing attempt author, unknown attempts, `suspected` confidence and inconclusive, flaky or infrastructure results yield none.
   - The core never calls the lifecycle.
5. **Echo suppression:** events carrying a `vitium/...` origin marker, or coming from a `vitium` principal or source, are dropped and never stored.
6. **Security routing:** Tutela findings, `security-rule` findings and findings with vulnerability language are `private-security` and are never publicly projectable.
7. **Producer outbox policy:**
   - pure, bounded backoff with injected jitter, `Retry-After` capped, a maximum number of attempts, and an expiry that leads to dead-letter;
   - the producer's build result is returned untouched;
   - mandatory reporting becomes a separate gate.

## Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| **Reuse the public `POST /api/v1/reports` route** (machines solve or bypass Turnstile, identify via `source.system`) | **Rejected** | It has an anonymous trust model. `source.system` would be self-asserted, any internet caller could pose as Praxis, there is no repository scope, and machine traffic would share the public throttle and receipts. The requirements explicitly forbid it. |
| **Long-lived per-repository shared secrets or API keys** stored as repository secrets | **Rejected** | Secrets get copied, rotation is manual, scope ends up broad, and a leaked key works until someone notices. It contradicts "no long-lived embedded secrets" and "short-lived credentials". |
| **GitHub Actions OIDC workload identity**, exchanged at a protected Vitium boundary for a short-lived credential bound to repository, environment and event types | **Proposed** | Nothing long-lived is stored in producers. The token carries attested `repository`, `ref`, `environment` and `job_workflow_ref` claims. Trust policy is per repository, and the token expires within minutes. It fits the injected `verifyWorkloadIdentity` port without changes to the core. Not verified here: no issuer, audience or trust policy is configured. |
| Mutual TLS client certificates per producer | Deferred | Viable for non-GitHub runners. Needs a PKI owner and rotation. It can plug into the same port. |
| Let verified passes auto-resolve | **Rejected** | VIT-VER-009/011 and VIT-AC-036. Ordo remains the transition authority, and a green build or a self-claim must not close a defect. |

## Open operator decisions (blockers for P1, not for this P0 contract)

1. **Identity provider and exchange.** Confirm GitHub Actions OIDC, and decide the audience value, the permitted `job_workflow_ref` and environment claims per producer, the credential lifetime, and where the exchange runs. Non-GitHub producers (Praxis local runs, agents) need a decision too.
2. **Hosting of the authenticated endpoint**: its own API and stage, separate from the public intake. Also decide its throttling, its IAM role, and whether storage is a separate table or a partition (Fides/Arca compatibility, VIT-DOM-010).
3. **Retention** of machine observations and dead-letter entries (VIT-OQ-009 is still open; none is invented here).
4. **Audit sink** for principal, decision and refusal events, and alerting on dead-letter growth.
5. **Who records verification attempts and their authors** (the `lookupAttempt` port). Without it no proposal is ever produced, which is the intended fail-closed default.
6. **Producer pilots.** Approve one Praxis and one CI/Dokimos pilot. Each needs its own upstream work item and PR, and distribution as a Conditor-managed binding (VIT-INT-018).
7. **Outbox defaults** (`DEFAULT_POLICY`). These are engineering placeholders, not an SLA.

## Consequences

- Vitium has a testable machine contract that fails closed before any endpoint exists.
- Producers cannot classify, confirm or resolve. Triage remains a human or Ordo act.
- The contract refuses the requirements sample's 65-hex `sha256`. Producers must send real SHA-256 digests.
- Single-line text fields mean producers send summaries plus evidence references, never log excerpts.

## Reversal

Everything lives under `service/machine/`, `schemas/machine/`, `tests/machine-*` and `docs/machine/`. Nothing else imports it, so deleting those paths removes the contract with no effect on public intake.
