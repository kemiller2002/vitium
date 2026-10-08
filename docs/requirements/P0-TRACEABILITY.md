# P0 requirements traceability

Date: 2026-10-08
Status vocabulary: **unit-verified** = candidate code plus Node tests that pass on this branch and fail under recorded mutations; **candidate** = code exists, only partially tested; **documented** = contract/prose only; **blocked** = needs an external decision, credential or tool run; **not started**.
Nothing here is **verified-passed** in the acceptance sense: no deployment, real AWS, real browser or installed Ordo/Conditor evidence exists.

## Machine reporting and rework lifecycle (#14, #15)

| Requirement | Stage | Source | Tests | Status | Outstanding gate |
|---|---|---|---|---|---|
| VIT-INT-013 machine contract separate from Turnstile | P0 | `service/machine-observation.mjs`, `service/machine-auth.mjs`, `service/machine-intake.mjs`, `service/machine-http.mjs`, `schemas/machine-observation.schema.json` | `tests/machine-intake.test.mjs`, `tests/machine-contract.test.mjs` | unit-verified | Contract review by Praxis/Dokimos owners; real OIDC verifier; private endpoint (not deployed) |
| VIT-LCY-010 failed verification returns to in-progress | P0 | `service/triage.mjs` | `tests/rework-lifecycle.test.mjs`, `tests/triage.test.mjs` | unit-verified | Ordo authority (#8) |
| VIT-LCY-011 reopen then resume, atomic shortcut | P0 | `service/triage.mjs` (`reopenAndResume`) | `tests/rework-lifecycle.test.mjs` | unit-verified | Ordo authority; operator UI not built |
| VIT-VER-009 failed never resolves; independent pass | P0 | `service/triage.mjs`, `service/verification-proposals.mjs` | `tests/rework-lifecycle.test.mjs` | unit-verified | Approved verifier policy (VIT-OQ-012) |
| VIT-INT-014 reusable producer adapters | P1 | `service/machine-outbox.mjs` (reference only) | `tests/machine-outbox.test.mjs` | candidate | Conditor-distributed bindings; upstream PRs need separate approval |
| VIT-INT-015 outbox/retry/idempotency/echo suppression | P1 | `service/machine-outbox.mjs`, `service/machine-intake.mjs` | `tests/machine-outbox.test.mjs`, `tests/machine-intake.test.mjs` | unit-verified (in-memory store) | Real DynamoDB/Arca concurrency proof |
| VIT-INT-016 workload identity and scope | P1 | `service/machine-auth.mjs` | `tests/machine-intake.test.mjs` | candidate | Token signature verification is an injected effect with no qualified implementation |
| VIT-INT-017 distinct event kinds with causal links | P1 | `service/machine-observation.mjs` | `tests/machine-intake.test.mjs` | unit-verified | — |
| VIT-INT-018 Conditor-installed bindings, one Praxis + one CI consumer | P1 | — | — | not started | Needs Conditor install (#5) and approved credentials |
| VIT-LCY-012 repeatable cycles, stale refusal | P1 | `service/triage.mjs` | `tests/rework-lifecycle.test.mjs` | unit-verified | Ordo authority |
| VIT-LCY-013 attempts keep work item/commit/runs | P1 | `service/triage.mjs` (`verificationAttempts`) | `tests/rework-lifecycle.test.mjs` | unit-verified | Praxis work-item integration |
| VIT-VER-010 inconclusive distinguishable | P1 | `service/triage.mjs` | `tests/rework-lifecycle.test.mjs` | unit-verified | — |
| VIT-VER-011 bounded agent retry and escalation | P1 | `service/triage.mjs` (`agentFailedAttemptLimit`) | `tests/rework-lifecycle.test.mjs` | unit-verified | Budget value needs Praxis policy approval |
| VIT-DOM-005 provenance class | P0 | `service/machine-observation.mjs` (`provenanceFor`), `service/intake.mjs` (`public-api`) | `tests/machine-intake.test.mjs` | candidate | Unified registry across human and machine records |

Build-system spec required tests ([VITIUM-BUILD-SYSTEM-REPORTING.md](VITIUM-BUILD-SYSTEM-REPORTING.md)): 1–8 have unit coverage in the files above; **9 (audited transitions under the qualified Ordo installation) is blocked** on Conditor/Ordo installation.

Acceptance: VIT-AC-032, 033, 034, 036 have unit-level coverage; VIT-AC-035 has unit coverage except real concurrent storage and live producer outage. None is end-to-end verified.

## Remaining P0 requirements

| Requirement | Source | Status | Outstanding gate / issue |
|---|---|---|---|
| VIT-UX-001..007 | `site/` | candidate | Real Playwright/axe/320px evidence (#2); private mode disabled |
| VIT-DOM-001 distinct identities | schemas, `service/` | candidate | F#/Limen typed domain (#6, #8) |
| VIT-DOM-002 opaque reference | `service/report-domain.mjs` | unit-verified | Live storage |
| VIT-DOM-003 versioned payloads | `schemas/` | candidate | Explicit migration path |
| VIT-DOM-004 product registry | `service/report-domain.mjs`, `site/submission.mjs` | candidate | Versioned registry with aliases |
| VIT-DOM-006 impact vs severity | `schemas/defect.schema.json` | documented | Triage model |
| VIT-API-001..005 | `service/intake.mjs`, `service/http.mjs`, `service/aws-handler.mjs` | unit-verified (simulated store) | AWS staging, Turnstile, DNS/TLS (#1) |
| VIT-API-006 retention/deletion | — | blocked | Operator decision (VIT-OQ-001..009, #13) |
| VIT-API-007 private security path | machine: `visibilityFor`; public: private-by-default storage | candidate | Escalation owner (#13) |
| VIT-LCY-001 legal transition model | `service/triage.mjs` | candidate | Must be under Ordo (#8) |
| VIT-LCY-002 classify before defect | `service/intake.mjs`, `service/machine-intake.mjs` | unit-verified | — |
| VIT-LCY-003 auditable triage | `service/triage-cli.mjs` | candidate | Real IAM principal/table test |
| VIT-LCY-004 explicit terminal reasons | `service/triage.mjs` | candidate | Expected-behavior/declined/superseded dispositions not modeled |
| VIT-INT-001 truthful GitHub handoff | `site/` | candidate | Browser evidence (#2) |
| VIT-NFR-001 Conditor install | `conditor.json` | blocked | Real `conditor init` run committed (#5) |
| VIT-NFR-002 Praxis/Ordo governance | — | blocked | Depends on NFR-001 |
| VIT-NFR-003 canonical hostname live | `DEPLOYMENT.md` | blocked | Pages enablement, DNS, TLS (#7) |
| VIT-NFR-004 secret redaction | credential guards in intake/machine envelope | candidate | Log/artifact redaction tests |
| VIT-NFR-005 ownership | — | blocked | Operator decision (#13) |
