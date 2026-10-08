---
id: VIT-REQ
title: Vitium product and engineering requirements baseline
status: proposed
version: 0.1.0
created: 2026-10-08
owner: vitium
authority: product-requirements-proposal
related:
  - PROJECT-CHARTER.md
  - docs/REPORTING.md
  - docs/GOVERNANCE.md
  - schemas/defect.schema.json
  - docs/requirements/VITIUM-ACCEPTANCE.md
  - docs/requirements/VITIUM-OPEN-DECISIONS.md
---

# Vitium requirements

This is a **proposed complete product-scope baseline**, not a claim that Vitium is implemented, authorized for production, or has passed a test. It expands the existing reporter and governance documents without superseding Conditor, Praxis, Ordo, security policy or accepted Echelon decision records. User decisions take precedence where applicable. A requirement is "specified" when recorded here, "implemented" only with code/evidence, and "verified" only after executable acceptance evidence.

## 1. Product boundary and stages

**Purpose:** Vitium is the system that receives reports of defects across Echelon software, makes investigation and resolution traceable, and measures whether corrective actions prevent recurrence.

**Non-goals:** Vitium is not a generic task manager, not an AI-agent orchestration engine, not the authority for application source code or releases, and not a public repository browser. It should not duplicate the responsibilities of Praxis (execution), Ordo (governed decisions), Dokimos (quality), Aegis (faults), Fides (identity), Arca (storage), or GitHub (repository workflow).

**Terminology:**
- **Observation/report**: what a person or machine says happened, whether or not it is verified.
- **Defect**: a triaged, accepted deviation from an identified expected behavior or contract. A report may ultimately be duplicate, invalid, expected behavior, security incident, feature request, or unknown.
- **Work item**: a commitment to investigate/remediate, usually owned in a product repository; multiple defects may share one work item and vice versa.
- **Evidence**: a versioned, sourced, timestamped reference (reproduction, logs, test, CI, commit, release, monitoring observation) with sensitivity rules.
- **Recurrence**: a subsequent, independently observed manifestation of a previously resolved defect or root-cause class, not merely a similar title.
- **Incident/security vulnerability**: separate response path; do not automatically publish as a normal defect.

Delivery stages (priority is product-sequencing, **not** defect severity):
- **P0 release foundation**: reliable human intake, abuse/privacy controls, private internal record and GitHub-free submission, safe triage, typed state/transition contract, basic reporter receipt, real Conditor governance and release verification.
- **P1 complete operational product**: issue synchronization, agent and CI intake, regression evidence, authenticated maintainer dashboard, status updates, search/deduplication, operational controls and audit.
- **P2 intelligence and ecosystem**: recurrence analytics, agent drift correlation, proactive trend reports, extensibility and advanced notifications.

## 2. Requirements

### A. Reporter experience

| ID | Stage | Requirement |
|---|---|---|
| VIT-UX-001 | P0 | A user MUST start a report at \`https://vitium.echelonfoundry.com/\` without learning GitHub, issue jargon, severity scales or repository identities. |
| VIT-UX-002 | P0 | Reporter MUST select the affected product or "unknown", describe actual/expected behavior and impact; title is required; reproduction steps, version, page and safe diagnostics are optional. |
| VIT-UX-003 | P0 | Before transmission, reporter MUST see what will be sent and the visibility/retention notice; review, edit and cancel MUST be possible. |
| VIT-UX-004 | P0 | The system MUST distinguish unsent draft, processing, durably accepted, quarantined/under review and rejected/error. Success MUST NOT appear before authoritative acknowledgment. |
| VIT-UX-005 | P0 | Intake MUST return a safe reference plus recovery guidance after successful durable receipt; anonymous submission MUST NOT require a GitHub account. |
| VIT-UX-006 | P0 | Native semantic controls, keyboard and assistive-technology support, responsive layouts to 320px, reduced-motion support and machine-operable Playwright selectors MUST be verified. |
| VIT-UX-007 | P0 | Form fields MUST validate input with actionable, accessible messages; never silently truncate or erase typed content after a recoverable error. |
| VIT-UX-008 | P1 | Each Echelon product SHOULD offer a contextual "Report a problem" entry point passing only explicitly approved, non-sensitive product/version/screen context; reporter can review and remove it. |
| VIT-UX-009 | P1 | Reporting MUST explain what happens next, provide safe contact/status options, and indicate when the user is unlikely to receive a personal response. |
| VIT-UX-010 | P2 | The system SHOULD permit locale-ready copy and accessible low-bandwidth/offline-safe draft behavior; drafts require an explicit retention and deletion design. |

### B. Domain records and authority

| ID | Stage | Requirement |
|---|---|---|
| VIT-DOM-001 | P0 | Observation, defect, work item, evidence, actor, product, version, occurrence and lifecycle event MUST have distinct typed identities and relationships. |
| VIT-DOM-002 | P0 | Every accepted report MUST have a stable opaque external reference independent of GitHub issue numbers and a unique internal identifier where appropriate. |
| VIT-DOM-003 | P0 | All persisted domain records and API payloads MUST be versioned, schema-validated and migrated explicitly without destroying historical meaning. |
| VIT-DOM-004 | P0 | Product identifiers MUST resolve through a canonical, versioned registry and aliases; unsupported names MUST not be silently assigned to another product. |
| VIT-DOM-005 | P0 | Sources MUST record reporter provenance class (anonymous human, authenticated human, application, CI, agent) without inventing identity or attribution. |
| VIT-DOM-006 | P0 | Records MUST distinguish reported user impact, triage severity, remediation priority, confidence and evidence availability; none may be inferred from the others by default. |
| VIT-DOM-007 | P1 | Internal history MUST be append-only or equivalently auditable: actor, timestamp, before/after state, reason, causation, correlation, source and verification are recoverable. |
| VIT-DOM-008 | P1 | A report MUST be able to link to zero or more defects; a defect to multiple reports, related defects, root causes, PRs, commits, verification runs, deployments and work items across repositories. |
| VIT-DOM-009 | P1 | Visibility, sensitivity, tenancy/product scope and retention classification MUST be explicit record attributes, not inferred from a public URL or user-supplied text. |
| VIT-DOM-010 | P1 | Canonical storage MUST use a provider-neutral port compatible with Arca; GitHub adapters MAY own work-item synchronization but MUST NOT leak GitHub's representation into the core model. |

### C. Intake API, safety and abuse

| ID | Stage | Requirement |
|---|---|---|
| VIT-API-001 | P0 | A versioned server-side HTTPS intake endpoint MUST accept GitHub-free customer reports; GitHub App credentials and storage secrets MUST never reach public HTML/JS. |
| VIT-API-002 | P0 | Intake MUST validate schema/size, sanitize URLs and rich text, reject unsafe content and handle malformed, overlong or unsupported payloads deterministically. |
| VIT-API-003 | P0 | The server MUST enforce rate limits, anti-automation/abuse policy, moderation/quarantine and bounded resource use without treating anonymous submissions as trusted. |
| VIT-API-004 | P0 | Writes MUST be idempotent at the supported retry boundary; duplicate delivery must not create multiple authoritative reports or issues. |
| VIT-API-005 | P0 | Failures MUST be typed (validation, abuse, throttled, temporary, permanent, unavailable) and must not invent a receipt when durable persistence fails. |
| VIT-API-006 | P0 | The system MUST define a safe retention, deletion, access, breach/escalation and data-subject request workflow before storing real customer reports. |
| VIT-API-007 | P0 | Security vulnerabilities and private customer details MUST have a non-public escalation path; public issue publication must not be the default for new direct submissions. |
| VIT-API-008 | P1 | Safe attachments MUST require an approved upload service, scanning/redaction, type/size caps, scoped retrieval and expiration; no direct unauthenticated public bucket. |
| VIT-API-009 | P1 | External callbacks and webhooks MUST validate origin/signature, freshness, replay, clock skew and least-privilege credentials; credentials must be rotated/revoked safely. |
| VIT-API-010 | P1 | Reporter-status lookup MUST be authorized or controlled by a high-entropy capability separate from public receipt IDs; enumeration MUST NOT reveal existence or confidential state. |

### D. Triage and governed lifecycle

| ID | Stage | Requirement |
|---|---|---|
| VIT-LCY-001 | P0 | Define a machine-readable legal state-transition model and guard conditions owned by Ordo or a domain-equivalent core; UI controls and API enforce the same model. |
| VIT-LCY-002 | P0 | New intake MUST first be classified; no untrusted report automatically becomes a confirmed defect or developer work item. |
| VIT-LCY-003 | P0 | Authorized triage MUST classify product/owner, suspected type, urgency, severity, priority, reproduction status and next step with auditable rationale. |
| VIT-LCY-004 | P0 | A defect can close as verified fixed, duplicate, not reproducible, expected behavior, declined or superseded; terminal reason MUST be explicit and reversible via authorized reopening. |
| VIT-LCY-005 | P1 | Every transition MUST enforce role/permission, mandatory evidence and known dependencies; invalid or stale concurrent transitions MUST be rejected or explicitly reconciled. |
| VIT-LCY-006 | P1 | A confirmed defect MUST link the responsible product team/repository and at least one governed remediation work item before entering active repair (or an explicit exemption). |
| VIT-LCY-007 | P1 | Duplicate consolidation MUST retain every reporter, occurrence, distinct evidence reference and original timeline; it must not erase historical reports. |
| VIT-LCY-008 | P1 | Reopened/regressed defects MUST keep prior resolution evidence, newly observed manifestation and release lineage rather than rewriting the original lifecycle. |
| VIT-LCY-009 | P1 | Status promises, owner assignment, escalation and aging thresholds MUST be configurable by product or policy and audited, not made up as universal SLAs. |

### E. Echelon integrations and automation

| ID | Stage | Requirement |
|---|---|---|
| VIT-INT-001 | P0 | Current GitHub issue handoff MUST remain truthful until the direct API is working; migration MUST not silently switch public/private storage or lose incoming issues. |
| VIT-INT-002 | P1 | GitHub integration MUST map internal defect/work-item links safely, handle edited/closed/reopened GitHub issues, rate limits, pagination, retries and permission failures. |
| VIT-INT-003 | P1 | External synchronization MUST use source identifiers, last-seen revisions and idempotency keys to avoid feedback loops, duplicate updates and destructive last-writer wins. |
| VIT-INT-004 | P1 | Echelon applications SHOULD emit a stable versioned defect-report contract through an explicit application adapter, not duplicate form logic in each repository. |
| VIT-INT-005 | P1 | Aegis runtime failures SHOULD produce safe diagnostic references, never raw secrets, and MUST require policy authorization before becoming a report. |
| VIT-INT-006 | P1 | Dokimos and CI MUST submit structured failures and quality evidence, distinguishing detected defects from hypotheses and flaky/infrastructure errors. |
| VIT-INT-007 | P1 | Praxis MUST accept vetted defect remediation requests with correlation IDs and return actual work/checkpoint/evidence references without Vitium forging execution state. |
| VIT-INT-008 | P1 | Ordo MUST own transition guards, remediation acceptance obligations, and rule changes; Vitium MUST not independently override governance. |
| VIT-INT-009 | P1 | Fides MUST protect internal operators with role- and resource-specific authorization; public intake MUST remain independent of a GitHub account. |
| VIT-INT-010 | P1 | Arca MUST be used behind a provider-neutral record port when its versioned binding is ready; migration and reconciliation must be tested. |
| VIT-INT-011 | P2 | Signal MAY supply shared feedback primitives only where boundaries are compatible; integration MUST not create competing reporter or survey authorities. |
| VIT-INT-012 | P2 | External integrations MUST expose capability/version compatibility, schema negotiation and explicit unsupported behavior rather than guess formats. |

### F. Reproduction, correction, independent verification

| ID | Stage | Requirement |
|---|---|---|
| VIT-VER-001 | P1 | Every confirmed defect MUST have falsifiable acceptance conditions: observed behavior, expected behavior, supported reproduction/evidence and environment/version scope. |
| VIT-VER-002 | P1 | Fix evidence SHOULD show regression test failure before the correction and success afterward; absence MUST be explicitly justified and independently reviewed. |
| VIT-VER-003 | P1 | Passing tests alone MUST NOT prove a fix; check test relevance, negative/adversarial cases and failure sensitivity, using Dokimos where qualified. |
| VIT-VER-004 | P1 | Verify across the declared matrix of affected product versions, supported browsers/platforms, integration boundaries and rollback scenarios proportionate to risk. |
| VIT-VER-005 | P1 | "Code merged", "fix built", "fix deployed", "verified resolved" and "reporter confirmed" MUST be separate facts and states/events, not one boolean. |
| VIT-VER-006 | P1 | Independent verification MUST have an actor/evidence authority distinct from the implementation self-report where risk policy requires it. |
| VIT-VER-007 | P1 | Link Git commits, PRs, test runs, release artifacts, deployed versions and evidence digests immutably; do not rewrite history when a regression occurs. |
| VIT-VER-008 | P2 | For recurrence, the system SHOULD correlate original and reintroduced defects, failed safeguard, intervening changes, architectural rules and confidence; suspected AI drift is a hypothesis, not an automatic conclusion. |

### G. Internal interface, communication and intelligence

| ID | Stage | Requirement |
|---|---|---|
| VIT-OPS-001 | P1 | Maintainers MUST have triage queue and detail views with scoped search/filter/sort by product, owner, state, severity, age, duplicates and evidence quality. |
| VIT-OPS-002 | P1 | Unauthorized users MUST NOT see private descriptions, logs, attachments, comments, existence hints, project identifiers or cross-product links. |
| VIT-OPS-003 | P1 | Reporters MUST have a safe means to add clarifications and receive relevant status changes where their verified contact/capability authorizes it; unsolicited notifications need consent. |
| VIT-OPS-004 | P1 | Notification delivery MUST be queued, idempotent, retryable, deduplicated and revocable; private details may not be sent to unverified recipients. |
| VIT-OPS-005 | P1 | Saved filters/export MUST enforce the same resource permissions and redaction as the UI, including aggregate small-group leakage protections where needed. |
| VIT-OPS-006 | P2 | Dashboards SHOULD report intake volume, validated defects, unresolved age, time-to-triage, time-to-verified-fix, recurrence, escaped defects and source coverage. |
| VIT-OPS-007 | P2 | Analytics MUST document denominator, sample/window, exclusions, uncertainty, missing data and deduplication; never treat report count as defect incidence without qualifications. |
| VIT-OPS-008 | P2 | Drift-related reporting SHOULD distinguish generated-code correlations, architectural deviations, inadequate tests and confirmed root causes; do not infer agent causality from coincidence. |

### H. Delivery, reliability, compliance and governance

| ID | Stage | Requirement |
|---|---|---|
| VIT-NFR-001 | P0 | Conditor MUST install and verify the qualified repository lifecycle; no manually invented lock, installation receipts, or completion state. |
| VIT-NFR-002 | P0 | Praxis and Ordo MUST govern change/evidence/state; canonical identity, provenance and handoff are mandatory where installed governance requires them. |
| VIT-NFR-003 | P0 | The public production hostname MUST be \`https://vitium.echelonfoundry.com/\`; DNS, Pages binding, trusted TLS, deployment and browser availability MUST all be witnessed before "live". |
| VIT-NFR-004 | P0 | Secrets MUST reside only in approved service stores; logs, telemetry, source, URLs, client assets and public artifacts MUST be redaction-tested. |
| VIT-NFR-005 | P0 | The platform MUST identify ownership of customer reports, moderation, retention, security escalation and operator actions before an unauthenticated production launch. |
| VIT-NFR-006 | P1 | Production MUST expose health/diagnostic status, safe structured error/trace IDs, intake failure and queue/backlog monitoring, alert routing and escalation without reporter data leakage. |
| VIT-NFR-007 | P1 | Define and test availability targets, overload/back-pressure, retry boundaries, disaster recovery/RPO/RTO and storage restore once the backend topology is chosen; values are not assumed here. |
| VIT-NFR-008 | P1 | CI/release MUST verify pinned immutable Echelon dependencies, test suite significance, browser accessibility/machine operability, negative auth cases, schema migrations, reproducible artifacts and supply-chain integrity. |
| VIT-NFR-009 | P1 | Releases MUST have staged rollout/rollback, schema backward compatibility where promised, feature flags for security-sensitive integrations and a documented incident runbook. |
| VIT-NFR-010 | P1 | Product integrations and public API MUST document compatibility, idempotency, paging, error codes, deprecation and data-export behavior without exposing internal provider tokens. |
| VIT-NFR-011 | P1 | Real data use MUST have documented retention/deletion, consent/contact basis, access reviews and audit-logging policy, including deletion propagation to downstream GitHub copies/attachments. |
| VIT-NFR-012 | P2 | Quality trends, performance and system cost MUST be instrumented against explicit baselines; avoid invented cost savings or unsupported reliability claims. |

## 3. Cross-cutting invariants

1. **Reporting is not proof**: a user report or failing test is not automatically a confirmed root cause.
2. **Reception is not resolution**: "accepted" means durably received, not fixed.
3. **Visibility follows data policy**, never the origin page, reporter claim or linked GitHub issue.
4. **Every server effect has an auditable, idempotent boundary** or an explicitly documented exception.
5. **Authoritative work stays in its owner**: Vitium correlates; Praxis executes; Ordo authorizes; GitHub stores repository-specific work items; Arca abstracts durable records.
6. **Every status change has a reason and actor**; missing evidence is represented as missing, not falsified as passing.
7. **No false SLA**: do not promise fix dates, guaranteed human replies or performance targets without approved service policy.
8. **Security defect path is private by default**; untrusted report text and attachments never execute as instructions.
9. **Automated analytics are hypotheses unless substantiated** by reproducible or independent evidence.
10. **The form does not count as launched** until real end-to-end submission and production operational controls are verified.

## 4. Acceptance authority and traceability

Executable behavior/scenarios are proposed in [VITIUM-ACCEPTANCE.md](VITIUM-ACCEPTANCE.md). Decision gaps and the cases where authority is not yet settled are in [VITIUM-OPEN-DECISIONS.md](VITIUM-OPEN-DECISIONS.md). Existing implementation issues #1–#7 remain valid; new epics should refer to stable IDs in this file and avoid copying its authority into conflicting descriptions.

**Requirements freeze is not claimed.** P0 scope is proposed for product review, especially the product/organization data-sharing boundary, anonymous status-token design, public/private migration, and operator policies. Do not mark this document "accepted" without the user's decision record.
