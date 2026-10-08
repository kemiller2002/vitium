# Claude mission: bring Vitium P0 to an evidence-backed release candidate

**Mission ID:** VIT-P0-2026-10-08
**Primary write repository:** https://github.com/kemiller2002/vitium
**Canonical public URL:** https://vitium.echelonfoundry.com/
**Status on authoring:** execution instructions, not proof of delivery
**Operating mode:** Claude Code principal orchestrator with delegated subagents, independent verification and genuine Conditor/Praxis/Ordo governance.

## 1. Repositories and permission boundaries

Explicitly inspect the following repositories if present. Confirm their actual Git remotes, current tags, policies and release contracts rather than assuming shared paths or packages:

| Repository | Purpose | Default permission |
| --- | --- | --- |
| kemiller2002/vitium | All implementation, requirements, tests, infrastructure candidate, agent records | **WRITE** |
| kemiller2002/conditor | Repository lifecycle installer, qualified versions, immutability and bootstrap | READ |
| kemiller2002/praxis | Work protocol, evidence, agent orchestration, immutable checkpoints | READ |
| kemiller2002/ordo | Decision/transition rules and lifecycle evidence | READ |
| kemiller2002/forma | Accessible UI components and machine-operable interaction contracts | READ |
| kemiller2002/limen | F#/WASM application execution boundary | READ |
| kemiller2002/aegis | Safe error and diagnostic boundary | READ |
| kemiller2002/arca | Storage-neutral persistence port | READ |
| kemiller2002/fides | Internal operator authentication and authorization | READ |
| kemiller2002/dokimos | Valuable tests, mutation-sensitive verification, quality gates | READ |
| kemiller2002/tutela | Application and dependency security evaluation | READ |
| kemiller2002/folio | Shared report/print presentation contracts where applicable | READ |
| kemiller2002/percepta | UX experiment and evaluation contracts | READ |
| kemiller2002/signal | Existing feedback/reporting primitives; avoid duplicate authority | READ |
| kemiller2002/visual-engineering | Visual quality and browser evidence | READ |
| kemiller2002/communication-engineering | Documentation and communication evidence | READ |

Treat missing/renamed repos or unpublished packages as **unverified** rather than silently substituting a newer or unqualified version. Do not change upstream repositories unless the defect is independently demonstrated, Vitium work cannot resolve it, and a separate bounded issue/PR with reproducible evidence is created. No upstream force pushes.

## 2. Authority to read before making changes

Read completely:

- \`AGENTS.md\`, \`PROJECT-CHARTER.md\`, \`context/CURRENT-STATE.md\`
- \`docs/requirements/VITIUM-REQUIREMENTS.md\`
- \`docs/requirements/VITIUM-ACCEPTANCE.md\`
- \`docs/requirements/VITIUM-OPEN-DECISIONS.md\`
- \`docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md\` (machine producer intake and failed-verification/rework lifecycle)
- \`docs/P0-IMPLEMENTATION.md\`, \`docs/REPORTING.md\`, \`docs/GOVERNANCE.md\`
- \`DEPLOYMENT.md\`, \`conditor.json\`
- \`infra/aws/README.md\`, \`infra/aws/template.yaml\`
- all current service and site entry points, tests and GitHub Actions workflows.
- GitHub issues #1, #2, #5, #6, #7, #8 and #13 first; inspect others for dependencies.

The requirements are *proposed*, not accepted wholesale. Do not invent authorization for undecided privacy, retention, AWS resource provisioning, real customer data, or production deployment. The user has authorized **working on P0 code and verifications**. A feature gate should remain off until security and operational approval is recorded.

### Known baseline: verify against live evidence

- The original static report form and GitHub issue prefill work as a baseline, subject to browser checks.
- The new private intake backend is a staging candidate in \`service/\`; the AWS SAM candidate is in \`infra/aws/\`.
- \`site/public-config.mjs\` has \`enabled: false\`. Keep it disabled until safe production gates have been genuinely satisfied.
- \`service/triage.mjs\` is a candidate domain transition model, not accepted Ordo authority.
- Conditor v0.5.0 **read-only plan** passed and isolated **installation preview** passed in GitHub Actions run https://github.com/kemiller2002/vitium/actions/runs/37772428835. The preview **did not commit** real generated lifecycle state to the repository.
- Node quality and SAM candidate build workflows passed as of this mission's preparation; verify the newest head, not a remembered green badge.
- The public GitHub Pages custom-domain deployment and live anonymous private intake are not established by these results.
- An earlier preview failed due to Ordo launcher packaging. The passing isolated workflow preserved Ordo's \`dist/\` payload via \`SDE_PAYLOAD_DIR\`; use that verified approach, not a handcrafted fake install.
- The frontend and service are transitional JavaScript; the target Echelon app core is typed F#/Limen with Forma presentation, using Conditor-qualified dependencies.

## 3. Mission objective and exit standards

Implement and genuinely verify all feasible **P0** requirements and acceptance scenarios without prioritizing P1/P2 dashboards, notifications or AI-drift intelligence ahead of the report-to-triage path.

Success is not measured by changed-file count or easy green tests. It requires a safe, semantically correct path from a person describing a problem to a **durably stored private observation**, an authorized triage disposition, and truthful receipt/error behavior. Preserve original report content, evidence provenance and legal transition histories. Distinguish observation, confirmed defect, remediation work item, and independently verified fix.

A complete **engineering-ready P0** can be achieved with secure local/integration proofs even if operator-only DNS/cloud provisioning cannot be done. If staging or production credentials are unavailable, finish all independent work, leave the public feature gate **off**, and report the remaining exact actions and tests instead of inventing success.

## 4. Spawn delegated agents and isolate ownership

Use available Claude Code subagents (Agent tool) and parallel git worktrees/branches where supported. If subagents are unavailable, execute the same assignments sequentially. The **principal integrator** owns orchestration, conflict resolution, final requirements traceability and review. Do not have multiple agents edit the same file without explicit handoff.

Start these specialists:

1. **Lifecycle/governance agent**. Own Conditor real install, immutable resolved releases, integration of generated files, compatibility conflicts and Praxis/Ordo CI verification. Read Conditor/Praxis/Ordo. Own only lifecycle/governance files and verification workflow changes.
2. **Typed domain agent**. Own versioned observation/defect identities, product registry, legal transition table and F# core design/implementation, with migration from current JS contracts. Own domain and schemas. Consult Ordo and Arca; do not prematurely assert Ordo authority.
3. **Intake/security agent**. Own authenticated private persistence, idempotency, challenge validation, abuse/throttle boundaries, failure semantics, AWS candidate and safe operator capability. Use Aegis/Tutela; no production secrets or unauthorized deployment.
4. **Forma/Limen UX agent**. Own report form, focus/keyboard/mobility, responsive UI, review/edit/submit/failure/receipt states and non-destructive F#/Limen scaffold migration. Own site/frontend files; preserve GitHub legacy fallback.
5. **Independent verification agent**. Own adversarial and Playwright/a11y checks, threat/model-test matrix, mutation-sensitive regression tests and evidence appraisal. **Must not self-certify code written by its counterpart agents.** Can propose fixes but their owners implement them.
6. **Release/operations agent**. Own safe runbooks, staging readiness, redacted CI outputs, Pages/DNS/TLS gaps, least-privilege IAM, disaster-recovery and operator-required decisions. No implicit cloud deployments.
7. **Build-system integrations agent**. Own versioned authenticated machine-observation contract, producer adapter strategy for Praxis/Ordo/Conditor/Dokimos/Tutela/Aegis/CI, provenance, dedup/retry/echo suppression and independent integration tests. Start with safe Vitium-only contract work; upstream modifications need separate work items/PRs and compatibility verification. This agent must not mistake a public Turnstile route for machine authentication.

Have each agent return: scoped changes/commit, real commands executed, passed/failed tests, relevant requirement and acceptance IDs, unresolved blockers and next dependencies. Integrate in dependency order rather than blindly merging parallel edits.

## 5. Execution phases (continue through feasible phases autonomously)

### Phase A: Discover, baseline, and plan

- Inspect \`git status\`, current branch and remotes, verified workflows, existing tags, real packages, installed tools, issue backlog and service code.
- Protect uncommitted user edits. Do not reset, force-push, or discard them.
- Create a feature branch named after the scoped P0 mission, according to existing Praxis rules. Prefer reviewable PRs over direct pushes to \`main\`.
- Map each P0 requirement to source module(s), evidence, issue, owner, dependency and status in \`docs/requirements/P0-TRACEABILITY.md\`.
- Record major architecture decisions/proposals; follow Ordo and Praxis conventions.

### Phase B: Genuine Conditor governance

- Reproduce the known passing Conditor isolated installation workflow and inspect its generated file list and official lock/receipts for content/integrity.
- Perform a real \`conditor plan\` before any mutation. Run authorized \`conditor init\`, \`verify\` and \`doctor\` against the correct target/release; do not synthesize or hand-copy a \`.conditor/lock.json\`, \`.ros\`, \`.sde\`, installation manifest or approval.
- Keep generated files only if the **real tool** produced them, verify source authority and compatibility with existing \`AGENTS.md\`, \`package.json\` and code, then commit in a bounded unit with genuine evidence.
- If an existing-file collision occurs, investigate the tool's approved adoption/upgrade path rather than bypassing the lifecycle engine. If incompatible, stop only this branch, document the exact failure and continue other safe phases.
- Make CI independently reject missing, drifted or unqualified installed capability state. Plan-only checks are necessary but not sufficient.

### Phase C: Echelon architecture and typed domain

- Evaluate the Conditor \`fsharp-limen-web\` scaffold in a separate temporary candidate so it cannot destroy the working reporter. Resolve application ownership and merge strategy *before* applying.
- Implement typed F# domain boundaries consistent with the actual qualified Limen and Forma interfaces. Minimize dependencies, prefer pure functions and explicit effects. Follow Arca port conventions where available.
- Model report, observation, defect, product, occurrence, actor, evidence, work item, visibility and timestamps distinctly. Keep deterministic normalization, typed errors, revision/idempotency guards, legal transitions, explicit reason and proof obligations.
- Align schema contracts with runtime validation, including unexpected properties, version negotiation and legacy data migration. Do not claim a transition is Ordo-authorized without using its actual installed contract.
- Preserve existing reporter behavior while changing implementation. Do not replace production-compatible behavior with a demo page or a one-off framework.

### Phase D: Private P0 intake and triage

- Inspect current \`service/report-domain.mjs\`, \`intake.mjs\`, \`http.mjs\`, \`aws-handler.mjs\` and \`triage-cli.mjs\`. Retire provisional JS implementations only after the replacement genuinely passes equivalent and stronger tests.
- Implement/verify GitHub-free report submission: input bounds, URL/token redaction, challenge verification, privacy classification, safe validation, idempotent durable write, distinct receipt from status capability, explicit response errors and no public data exposure.
- Test concurrency and partial failures against the actual adapter. A local in-memory mock is insufficient to prove DynamoDB concurrency behavior.
- Keep data private, triage roles least privileged and the public service unable to enumerate/read stored reports. Separate reporter intake and internal operator authorization (Fides only when qualified).
- Protect against credential leakage, forged user reports, replay, unbounded queue growth, injected agent instructions and duplicate downstream issues. Never run reporter-provided repro scripts.

### Phase D2: Automated Echelon reporting and repeatable defect rework

**Mandatory architecture/behavioral contract for P0; producer rollout can remain separately gated as P1.** Read `docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md` in full. Implement feasible contract/schema/transition/test work while respecting dependencies.

- Define a separate, authenticated machine-to-machine observation protocol. Praxis, Ordo, Conditor, Dokimos, Tutela, Aegis and CI must have a common versioned submission envelope (system identity, repo, commit, work item, run/test/check, occurrence, result, redacted evidence, stable eventId/correlation). Do NOT send machines through the anonymous public Turnstile endpoint.
- Design secure scope-bound, short-lived workload authentication and avoid hardcoded repository credentials. Machine events start as observations; no self-reported failure or green build may automatically confirm or close a defect.
- Design idempotent submission, bounded outbox/retry and failure visibility while preserving the original build result. Retries cannot spawn multiple authoritative defects, and Vitium's own CI must not recursively create reporting loops.
- Explicitly implement and test the repeating **repair → verification fails → rework → verification → passes → resolved** loop. An independent failed verification must return `awaiting-verification → in-progress` with run, attempt ID, candidate commit, verifier and failure evidence. Do not mark the defect resolved.
- Permit `resolved/closed → reopened → in-progress` or `reproducing` when a new occurrence is proven. Preserve prior passing evidence and each historical repair attempt. A UI "resume work" shortcut may apply two guarded events atomically, never erase or bypass the reopen step.
- On `in-progress → awaiting-verification` capture the candidate revision, attempt ID and verification request. On `awaiting-verification → resolved` require genuine independent pass, not only a passing unrelated build. Inconclusive/flaky/infrastructure failures must remain distinguishable.
- Preserve stable defect identity across arbitrarily many review/rework iterations, with optimistic concurrency, immutable evidence, auditable transitions, bounded agent retry/budget and explicit human escalation.
- Add adversarial tests for stale verification, old tests on new candidate revisions, missing failure evidence, forged identity, replay, conflicting authors, recurrence, producer outages, and greenwashed agent self-approval.
- Do not create upstream production integrations until a scoped service identity, safe environment, and architectural decisions are approved. Document source-specific adapter rollout as first P1 integration increment if not authorized in this P0 mission.

### Phase E: Real UX, security and quality proof

- Use Forma as the UI component authority and the qualified Limen boundary for events/fetch. Ensure all interactive elements are machine-operable with Playwright.
- Preserve expected and observed descriptions, optional steps, clear data-publication notices, review/edit/cancel, pending/accepted/error states, screen-reader feedback and safe retry.
- Add browser tests in Chromium at 320px, 375px and desktop; keyboard-only traversal, reduced motion, meaningful contrast/focus, form validation, long text and security-relevant negative cases. Use genuine axe checks if approved/available.
- Test without GitHub account where private intake is supported; test legacy GitHub handoff without accidentally creating a public issue.
- Run negative tests that intentionally mutate or bypass validation, data visibility, legal transitions and fix evidence. Tests must fail under plausible incorrect implementations.
- Have independent verification agent inspect the code and acceptance artifacts. Prefer actual failure-before/fix-after proof for observed defects.

### Phase F: Operations and release candidate

- Validate SAM template, build/package, IAM scope, origin/CORS limitations, challenge configuration, request limits, secret rotation, log redaction, queue/retention and rollback procedures. Never substitute static schema checks for runtime security.
- Establish safe staging integration tests when credentials and operator authorization exist. Do not provision production infrastructure, DNS, Pages settings, public secrets, chargeable resources or real customer intake just to make a dashboard green.
- The service API's candidate hostname is \`intake.vitium.echelonfoundry.com\`; site is \`vitium.echelonfoundry.com\`. Treat them as different security boundaries.
- Leave \`site/public-config.mjs\` disabled until a real secure HTTPS endpoint, verification key, moderation/retention policy and live end-to-end test are approved.
- Do not claim P0 shipped if Conditor, privacy, browser or runtime integration gates remain incomplete.

### Phase G: Integrate, review and deliver evidence

- Commit independently reviewable changes under actual Praxis work items if installed; link GitHub issues and cross-component requirements. Keep an immutable commit and test record.
- Create or update focused GitHub issues when a defect is found. Do not make unrelated sweeping changes, postpone known P0 blockers without recording them, or suppress tests to pass CI.
- Resolve CI failures by fixing their cause. Never weaken tests or falsify reports, runs, artifact identities or evidence.
- Update \`context/CURRENT-STATE.md\`, \`docs/P0-IMPLEMENTATION.md\`, \`docs/requirements/P0-TRACEABILITY.md\` and decision records with actual evidence.
- Open reviewable PR(s) in Vitium when permissions allow; otherwise leave commits and exact review commands. Never force-push or auto-merge around policy.
- Produce a final handoff containing: commits/PRs, passed and failed commands, requirement/scenario coverage, real Conditor lock and version evidence, browser evidence, security findings, decisions needing operator approval, and a short prioritized blocker's list.

## 6. No-shortcut rules

- No Kubernetes. No invented services, release versions, product packages or authentication providers.
- No guessed GitHub issue authority, data retention period, SLA or secret.
- No credentials in source, public Pages assets, URL parameters, comments, test fixtures, generated logs or Claude transcripts.
- No falsified green CI, simulated deployment, made-up production receipt, fabricated governance installation, or "test passed" when it was not run.
- No silently rewriting the user's product requirements or approved Echelon system rules.
- Do not ask the user to resolve reversible engineering choices. Use an explicitly recorded, lowest-risk provisional approach and continue. Ask only when an action needs external credentials, spending authorization, irreversible data effects, or a consequential product/privacy decision.
- Do not pause merely to provide status. Continue executing safe work, recording progress and handoffs, until all feasible P0 work is complete or genuinely blocked.

## 7. Explicit additional acceptance gates

- Machine producer contract and identity model reviewed; versioned Vitium source adapter has testable examples and denies untrusted provider claims.
- Verified state transition loop including **two or more failed iterations** before a passing verification and a separate later recurrence from resolved/closed.
- Evidence history and candidate commits do not disappear when verification fails or the issue is reopened.
- Autonomous Praxis repair attempts stop at a bounded policy threshold and escalate instead of silently declaring success.
- No agent states that the source producer adapters, machine API or Ordo transition authority are **deployed** without genuine integration evidence.

## 8. End condition

The mission ends with either:

**A. Evidence-backed P0 candidate:** all feasible P0 behaviors and independent checks pass, Conditor's genuine installation is incorporated, and external deployment/operator gates are clearly identified; **or**

**B. Precise blocked handoff:** implemented code and tests are committed, and each remaining blocker names the responsible service, exact failing operation, acceptance ID and one required external decision/action.

Return a concise summary and links to actual GitHub work. Do not claim production readiness until an actual verified private intake, operator approval and canonical TLS site exist.
