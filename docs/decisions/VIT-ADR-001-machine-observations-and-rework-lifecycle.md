# VIT-ADR-001: Machine observation contract and repeatable rework lifecycle (provisional)

Status: **proposed / provisional engineering choice** — not an Ordo-approved policy, not an operator decision, not a deployed service.
Date: 2026-10-08
Issues: #14 (VIT-INT-013..018), #15 (VIT-LCY-010..013, VIT-VER-009..011)
Specification: [VITIUM-BUILD-SYSTEM-REPORTING.md](../requirements/VITIUM-BUILD-SYSTEM-REPORTING.md)

## Context

Echelon build systems need to report evidence-backed observations to Vitium without the anonymous Turnstile route, and defects must cycle through failed verification, rework, reopening and re-verification without losing history. Ordo is the eventual transition authority, Fides/OIDC the eventual identity provider and Arca the persistence port; none are installed or qualified in this repository yet. The mission rules say reversible engineering choices should be made at lowest risk and recorded rather than escalated.

## Decisions (each reversible)

| # | Decision | Why lowest risk | Replace when |
|---|---|---|---|
| 1 | Machine envelope v1.0 is a strict, closed schema (`schemas/machine-observation.schema.json`) validated by `service/machine-observation.mjs`; unknown fields are refused. | Additive evolution through a new `schemaVersion` is safer than tolerating unknown data. | Contract review with Praxis/Dokimos owners. |
| 2 | Producers must send `classification: "untriaged"`; any other value is refused. | Machine events can never self-classify into a defect (VIT-LCY-002, VIT-OQ-013). | Never relaxed without a product decision. |
| 3 | Identity is a verified short-lived workload credential (≤15 min lifetime, `sub`/`iat`/`exp`/`jti`) mapped through a **server-side binding registry** to system, repositories, environments and event types. Payload `source.system` is checked against the binding, never trusted. Signature verification is an injected effect; no JWT library is added. | Avoids new dependencies and long-lived secrets; compatible with GitHub Actions OIDC. | Fides or an approved OIDC verifier is qualified (VIT-OQ-002). |
| 4 | Idempotency key is `eventId`. Same eventId + same content + same workload subject → replay acknowledgment; any difference → `409 event_conflict`. | Retries cannot create duplicates or rewrite stored evidence. | — |
| 5 | Candidate duplicate key = SHA-256(repository, checkId, category, normalized observed text). Commit and run are excluded so the same failure on different commits correlates as **occurrences**; nothing is merged automatically. | Matches spec test 2 and VIT-OQ-014 (triage decides). | Fingerprint review with Dokimos. |
| 6 | Echo marker: Vitium-minted causation IDs start with `vitium:`. Intake answers `202 suppressed` and the producer outbox refuses to enqueue such events. | Simple, testable loop breaker (spec test 8). | Vitium issue sync (#10) is implemented. |
| 7 | Security findings and all Tutela events get `visibility: restricted-security`. | Never routes a vulnerability into public issues (VIT-API-007). | Security escalation policy is approved (#13). |
| 8 | Machine results only **propose** transitions (`service/verification-proposals.mjs`); an authorized verifier applies them under their own identity. | A green build, agent claim or forged status cannot close a defect (spec test 7). | Ordo transition authority is installed. |
| 9 | `requireIndependentVerifier` defaults to **true**: the actor who submitted the candidate cannot record its verification result. Relaxing it needs an explicit policy argument. | VIT-VER-006, VIT-OQ-012. | Risk policy approved under Ordo. |
| 10 | Agent failed-attempt budget defaults to **3 failed verifications per cycle** (a cycle restarts at each `reopened`). After that an `actorKind: "agent"` submission is refused; a human must submit or move the defect back to triage. | Bounded autonomous retry (VIT-VER-011). The number is a placeholder, not an approved SLA. | Praxis budget policy approved. |
| 11 | Inconclusive results use a recorded `awaiting-verification → awaiting-verification` event with an explicit cause (`flaky`, `infrastructure`, `environment`, `timeout`, `missing-test`); they neither resolve nor count as failures. | Keeps flaky/infra results distinguishable (VIT-VER-010). | Ordo models it differently. |
| 12 | Every verification submission needs a never-before-submitted attempt ID; results must match the latest submitted attempt and candidate revision; the request evidence cannot be reused as result evidence; transitions dated before the latest event are refused. | Rejects stale, out-of-order and old-test-on-new-revision results. | — |
| 13 | Reopening records `priorResolutionSequence` (derived from history, not caller input) and requires recurrence evidence plus affected release; `reopenAndResume` applies both events or neither. | Preserves resolution lineage (VIT-LCY-008/011). | — |
| 15 | Actor identities are compared after NFKC normalization, trimming and case-folding; attempt IDs likewise. Command text fields are validated as bounded strings before any guard. | Closes self-certification via `" alice "`/`"Alice"` found in independent review. | Identities come from Fides/OIDC subjects. |
| 16 | `actorKind` is mandatory on verification submissions; undefined policy values keep defaults; malformed policy is refused. | Agents cannot skip the retry budget by omission. | Actor kind derived from the authenticated principal. |
| 17 | The supplied history must be gap-free (`sequence` 1..n, `length === revision`), chained (`from` = previous `to`) and end in the record state. | Forged or truncated history cannot hide earlier failures or attempts. | Ordo/Arca event store provides integrity. |
| 18 | Evidence URIs must not contain credentials anywhere (path, decoded query) and must not target IP literals, `localhost` or internal names; all envelope strings are credential-scanned. | Prevents secret leakage and metadata-address references. | An approved evidence-host allowlist. |
| 19 | A machine `verification.passed` from the workload that submitted the candidate is flagged `selfReported` and cannot be accepted. | A workload's report on its own fix is not independent evidence. | — |
| 20 | Machine intake does not order events itself: every delivery is stored as an observation, and ordering is enforced where it matters, when a proposal is matched to the latest attempt and the lifecycle refuses stale or out-of-order results. | Rejecting out-of-order deliveries at intake would lose evidence. | Per-source sequence numbers are agreed. |
| 14 | No machine route is added to `infra/aws/template.yaml` or the public site. | No deployment, IAM or credential decisions have been approved. | Operator approves a private machine boundary. |

## Consequences

- Four pre-existing tests in `tests/triage.test.mjs` were updated because they used the same actor to submit and verify, verified with no recorded submission, or used a fixture whose history exceeded its revision. All three are now refused by design.
- An independent verification review found self-certification and retry-budget bypasses, missing history integrity, unchecked credential locations, an outbox crash and schema/runtime gaps in the first candidate. Each is reproduced in `tests/adversarial-regressions.test.mjs`, which fails on the first candidate and passes on the fix.
- `service/triage.mjs` remains a pure candidate model. Passing its tests is **not** integrated Ordo governance (spec test 9 remains open).
