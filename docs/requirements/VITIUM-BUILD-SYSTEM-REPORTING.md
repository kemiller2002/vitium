# Machine-generated defects and rework loops

Status: **proposed contract; not a deployed service or existing Praxis integration**  
Canonical service: Vitium, at https://vitium.echelonfoundry.com/  
Applies to: Praxis, Ordo, Conditor, Dokimos, Tutela, Aegis, CI/build jobs and authorized engineering agents.

> **Implementation status (2026-10-08):** a Vitium-side candidate of this contract, its producer outbox and the rework lifecycle exist in `service/` with unit tests for required tests 1–8; see `docs/requirements/P0-TRACEABILITY.md` and `docs/decisions/VIT-ADR-001-machine-observations-and-rework-lifecycle.md`. It is still not a deployed service, and required test 9 (qualified Ordo) is open.

## Design intent

Every Echelon engineering system should be able to report a verified observation (or verification attempt result) to Vitium without copying customer secrets or requiring a human to create a GitHub Issue. Vitium correlates reports into defects and their repair/verification cycles; the originating system remains authoritative for its own test/build/work status.

**Reporting must never turn an automated failure into a confirmed defect without classification.** A failing unit test, infrastructure outage, flaky check, quality-rule violation or agent suspicion is initially a **machine observation**.

The existing anonymous public `POST /api/v1/reports` and Turnstile workflow is **not** a machine-to-machine API. Do not reuse that public route, anonymous trust model or public receipt mechanism for internal engineering telemetry.

## Contract: authenticated automated observations

Propose `POST /api/v1/observations` behind a separately authenticated service boundary. The eventual endpoint and hosting implementation are subject to operator and Fides/Arca compatibility approval. This is a sample of the domain envelope, **not** a currently accepted wire schema:

```json
{
  "schemaVersion": "1.0",
  "eventId": "0276f8ac-a673-4d62-85a7-5d2292ef0cdd",
  "eventType": "observation.detected",
  "source": {
    "system": "praxis",
    "repository": "kemiller2002/summa",
    "installationId": "qualified-system-instance",
    "version": "verified-source-release"
  },
  "subject": {
    "workItemId": "WI-0042",
    "commit": "f6a987d3c71ad2f4ced1711528e296a42c51d9f4",
    "runId": "pipeline-run-123",
    "checkId": "verify-abi",
    "environment": "ci"
  },
  "finding": {
    "category": "test-failure",
    "summary": "Routing contract failed during regression verification",
    "expected": "Route matches verified binding",
    "observed": "Binding assertion failed",
    "classification": "untriaged",
    "confidence": "observed"
  },
  "evidence": [
    {
      "kind": "test-result",
      "uri": "https://github.com/kemiller2002/summa/actions/runs/123",
      "sha256": "f5b265b3274bc9ef0876bc1b0b160bdf1c0c79e26613f18928a7d89df74eead96"
    }
  ],
  "correlation": {
    "defectId": null,
    "verificationAttemptId": null,
    "causationEventId": null
  },
  "observedAt": "2026-10-08T12:00:00Z"
}
```

Use validated immutable source identifiers. Commit hash, system version, actor claims, test artifacts and correlation IDs must come from the source or an attested workflow, not generated placeholders. Actual schemas should define bounds, enum sets, compatibility, missing fields and validation errors. Report references and data access permissions must be separate concerns.

### Submission security

- Verify sending system identity via scoped, short-lived machine credentials or attested GitHub Actions OIDC workload identity exchanged at a protected server boundary. Never rely on a repository path or a caller-provided `source.system` for authorization.
- Bind identity to allowable repositories, environments, event kinds and event scopes. Use least privilege, rotation, expiry, replay protection, traceable principal and audit events.
- Use signed/attested origin and immutable artifact digests where available. Do not grant CI agents direct access to Vitium's private table or private GitHub Issues.
- No tokens, customer PII, entire log dumps, raw prompts, secrets, attachment contents or stack traces in ordinary event bodies. Send redacted references plus immutable digests and retention policy.
- Reject oversized, malformed or incompatible payloads and report actionable typed failures, without accepting disguised user-submitted commands.

### Reliability and causality

- `eventId` identifies delivery idempotency; a stable finding fingerprint based on source repository + rule/test + affected version + normalized signature is a **candidate duplicate key**, not an automatic merge decision.
- Preserve unique occurrences and run attempts even when they correlate with an existing defect. Do not erase original reports.
- On Vitium outage, use bounded local outbox / retry with backoff and expiration, report non-delivery in origin build evidence, and avoid hiding the build's original result. If the repository policy makes reporting a mandatory gate, surface that as a **separate gate failure** rather than overwriting the test status.
- Retries, concurrent delivery, replay and out-of-order events must not duplicate authoritative observations or regress state. Use expected revision/causation IDs, explicit reconciliation, and a dead-letter/repair path.
- Never create infinite feedback: Vitium-originated issue updates must carry correlation/causation markers; adapters must detect their own echoes.
- Direct machine ingestion does not authorize `resolved`, `closed`, `confirmed` or `in-progress` state transitions. A trusted verification result can be proposed for guarded transition only after policy checks.

## Component responsibilities

| Component | Producer event | What Vitium records |
|---|---|---|
| Praxis | Work/agent execution failure, stalled remediation, verification handoff | Observation tied to work item, execution attempt, commit and evidence refs |
| Ordo | Illegal transition / governance integrity failure | Violation observation; Ordo remains transition authority |
| Dokimos | Regression failure, mutation weakness, relevant quality finding | Test identity, failure fingerprint and observed environment |
| Conditor | Installation/upgrade/compatibility/verification failure | Qualified version, install step and immutable provenance links |
| Tutela | Security rule failure | Private security-classified observation, never a public issue |
| Aegis | Runtime exception/fault correlation | Redacted fault identity and safe diagnostic reference |
| CI/build | Build, test, packaging, integration or deployment verification failure | Run + job + artifact identity, severity unassessed pending triage |
| Other agents | Evidence-backed symptom or suspected defect | Agent identity, run context, confidence and source of observation |

Implement the **shared typed adapter and protocol in Vitium first**, then provide reusable Conditor-managed consumer bindings for source repositories. No one-off curl scripts with long-lived embedded secrets. Do not change upstream repositories without a separately approved work item/PR. Validate one Praxis producer and one CI/Dokimos producer end-to-end before scaling rollout.

## Bidirectional defect state and verification cycle

The required cycle is **repeatable without limit**, subject to authorization and bounded agent execution:

```text
new -> triaged -> reproducing -> confirmed -> in-progress
                                             |
                                             v
                                    awaiting-verification
                                      /             \
                       failed test + proof         passed test + proof
                                   /                   \
                              in-progress             resolved
                                   ^                     |
                                   |                new recurrence
                                   |                     v
                                   +----------- reopened -----------+
                                    new attempt + linked work item
```

- A fix being committed/merged is **not** verified resolution. `in-progress → awaiting-verification` needs a candidate revision, work/attempt identifier and evidence of submitted verification.
- **Failure in verification:** `awaiting-verification → in-progress`, with **failed** result, verifier identity, test/run evidence, reason, candidate revision and incremented attempt. Keep the failed artifact for diagnosis. The system may create a new Praxis work attempt; do not silently rewrite the old one.
- **Passing verification:** `awaiting-verification → resolved` only with qualifying passing evidence and appropriate authority, plus release/environment scope. Distinguish passed tests from confirmed deployment and customer-observed success.
- **Regression after resolution:** `resolved/closed → reopened → in-progress` (or `reproducing` if root cause is uncertain). The first step records recurrence proof, old resolution link, and release lineage; the second records a new authorized work attempt. A user-facing "Reopen and resume" may perform both legally guarded events atomically, not skip the audit history.
- Repeated fail/rework/pass/fail cycles retain the same stable defect identity, distinct `verificationAttemptId`, event ID, test result, code revision, verifier, work item, and linked evidence. Preserve previous passing evidence even when superseded by a regression.
- Test failures caused by flaky or infrastructure conditions should be flagged `inconclusive` and not automatically marked regressions; allow another verification run with complete evidence.
- Autonomous agent repair loops must have explicit owner, attempt limits, budget and stop/escalation policy. Never retry indefinitely just to green tests or permit an author to self-certify when independent verification is required.
- Require optimistic concurrency and role-scoped transitions, append-only or equivalently auditable event history and independent negative tests. Automated build events may suggest a transition but cannot bypass Ordo.

## Required tests before declaring implementation complete

1. Publish two identical `observation.detected` events: receive one idempotent observation with two delivery acknowledgments, no duplicate authoritative defect.
2. Same fingerprint on distinct commits/runs: retain two occurrences linked to one candidate defect rather than collapsing evidence.
3. Replay, forged identity, mismatched repo scope, expired workload token, out-of-order events, unavailable Vitium, retry exhaustion, 429 and unsafe evidence must fail safely.
4. Praxis/CI tests must keep their own failed result independent of Vitium availability and must expose telemetry delivery errors without losing diagnostic evidence.
5. Drive `in-progress → awaiting-verification → in-progress → awaiting-verification → resolved`, checking failed/passed artifact identity, agent work attempts, append-only sequence and revision conflicts.
6. Drive `resolved → reopened → in-progress → awaiting-verification → resolved`; preserve original resolution and regression evidence. `closed` reopening must work under policy.
7. Prove that a green build, an agent's own claim, a malformed verification event, or a forged passing status cannot close the case.
8. Ensure automatic quality reporting from Vitium's own CI does not recursively generate duplicate defects or infinite issue loops.
9. Verify audited permitted transitions and refusal of unauthorized/invalid paths under the qualified Ordo installation. Running a pure candidate test alone is not production governance proof.

## Roadmap boundary and owner

The contract and lifecycle invariants belong in the **P0 engineering baseline** so data and state machines are designed correctly before expanding. Actual upstream producer rollout, private machine-authenticated endpoint, background outbox and UI dashboards may be built in **P1** as independent increments, unless explicitly promoted by a product decision.

Related: `VIT-INT-006/007/008`, `VIT-LCY-005/008`, `VIT-VER-005/006/007`, issues #8, #10 and #11. **No live source integration is implied by this document.**
