---
id: VIT-ACCEPT
title: Vitium executable acceptance scenarios and release gates
status: proposed
version: 0.1.0
created: 2026-10-08
owner: vitium
source: docs/requirements/VITIUM-REQUIREMENTS.md
---

# Vitium acceptance scenarios

These are **testable specifications**, not evidence that the tests exist or have passed. Each scenario must be mapped to an executable automated check, production acceptance observation, or a justified manual security review before its associated requirement can be marked verified. Scenario IDs are stable.

## P0: public intake, safety, state model and governance

| Scenario | Requirements | Given / when | Required result |
|---|---|---|---|
| VIT-AC-001 | UX-001/002/006/007 | At 320px, 375px and desktop, keyboard-only and screen-reader users open the canonical site and submit a report with all required fields | Native controls and labels work; actionable error focus; no lost contents; no overflow; machine-driven completion succeeds |
| VIT-AC-002 | UX-003/004, INT-001 | A reporter fills the original GitHub handoff form and clicks Review, Edit, or Continue | Preflight contents are shown and editable; no "submitted" state appears; GitHub is the only authority to complete this legacy path |
| VIT-AC-003 | UX-004/005, API-001/005 | Anonymous reporter submits valid input through the new direct API, without any GitHub session | API reports a durable receipt only after commit; new case is private; readable acknowledgment without confidential issue IDs |
| VIT-AC-004 | API-002, UX-007 | Submit missing, oversized, malformed, hostile, unsupported or mixed-schema payload | Stable typed 4xx/validation response, no authoritative report and no secret disclosure; client preserves harmless form values |
| VIT-AC-005 | API-003/005 | Burst high-volume traffic and abuse attempts; exceed per-source limits | Rate limiting/moderation or a defined rejection; no unbounded queue/storage use; reporter receives safe error/retry guidance |
| VIT-AC-006 | API-004, DOM-002 | Replay identical accepted request with an idempotency key, including concurrent or partially failed dispatch | One durable original report, stable reference, no duplicate GitHub work item; conflicts rejected predictably |
| VIT-AC-007 | API-005, NFR-006 | Durable data store fails after validation; GitHub integration is unavailable; retry occurs | No false accepted receipt; acknowledged state remains valid if downstream sync fails; retry is safe and observable |
| VIT-AC-008 | API-006/007, NFR-004/005/011 | Customer accidentally includes a token, private data, a suspicious attachment or possible vulnerability | Redaction/quarantine/private escalation; never auto-publish public GitHub issue or log secrets; designated operator receives controlled action |
| VIT-AC-009 | API-010, OPS-002 | Guess a public receipt, enumerate references or attempt cross-product status lookup | No existence/status leakage; only valid status capability or authenticated permission grants safe information |
| VIT-AC-010 | DOM-001/003/004/005/006 | Ingest known/renamed/unknown product, human and machine source, varying impact and versioned schema | Distinct typed identities, safe alias resolution, explicit source and unmapped values, schema compatible/refused with a clear error |
| VIT-AC-011 | LCY-001/002/003 | Reporter submits plausible but unverified error and a triager classifies it | Creates observation only; authorized triager records severity/priority/owner independently and chooses permitted next transition |
| VIT-AC-012 | LCY-001/004 | Request illegal transition, incomplete close reason, close as duplicate, or reopen | Illegal state refuses; valid closure has explicit reason; reopening preserves original closure evidence and history |
| VIT-AC-013 | NFR-001/002/008 | Fresh clean checkout processes manifest through real Conditor lifecycle, then Praxis/Ordo verification | Immutable qualified installation; genuine tool lock/evidence; CI fails drifted or missing installation; no synthetic receipts |
| VIT-AC-014 | NFR-003, UX-001 | Production Pages deploy with configured custom domain and verified DNS/TLS | HTTPS canonical URL serves site and all resources; no redirects to unrelated domain; failing workflow never counted as a deploy |
| VIT-AC-015 | API-001/007, NFR-004 | Inspect published page, bundles and logs for GitHub App key, credentials, PII in URLs and raw fault trace | No secrets or customer data present; redaction is proven by negative canary test |

## P1: investigation, integrations and resolution

| Scenario | Requirements | Given / when | Required result |
|---|---|---|---|
| VIT-AC-016 | DOM-007/008/009, LCY-005 | Two operators update same defect, or unauthorized operator tries transition | Conflict/refusal or auditable merge; no lost event; role/resource guard enforced |
| VIT-AC-017 | LCY-006/007/008 | Two unrelated reports describe a verified common defect; fix reappears in a later release | Both reports retained, duplicate relationship preserved, root case and new occurrence linked without history rewrite |
| VIT-AC-018 | LCY-009, OPS-001 | Triage queue contains old, stalled, closed and unassigned issues across multiple apps | Authorized filters/search correctly display age, owner, source, status and product without inventing SLA |
| VIT-AC-019 | INT-002/003 | GitHub issue is edited/reopened; webhook duplicated, delayed, reordered or denied | No feedback loop or duplicate; source revisions tracked; non-authoritative changes not silently accepted |
| VIT-AC-020 | INT-004/005/006 | Aegis reports error, CI reports test failure, Dokimos flags test weakness and a user submits a symptom | Provenance and classification preserved; suggestions not mislabeled confirmed defects; sensitive context not auto-transmitted |
| VIT-AC-021 | INT-007/008 | Vitium dispatches a vetted remediation to Praxis and Ordo blocks an unauthorized transition | Genuine work and evidence IDs returned; no fabricated agent completion, bypass or local workflow shadow state |
| VIT-AC-022 | INT-009/010, OPS-002/005 | Sign in through Fides, read/write via Arca adapter, query/export restricted records | Identity establishes only authentication; repository/project permissions separately enforced; no unauthorized record/aggregate disclosure |
| VIT-AC-023 | VER-001/002/003 | Agent reports a defect fixed with only easy-passing tests; malicious mutation intentionally reintroduces bug | Closure is refused or explicitly flagged; mutation proves real regression test sensitivity; independent review required per risk |
| VIT-AC-024 | VER-004/005/006/007 | PR merges and build succeeds but affected release has not deployed or verified | UI distinguishes implementation, build, deployment, verified resolution and any reporter confirmation; does not prematurely close |
| VIT-AC-025 | API-008 | Oversized or malicious screenshot/log submitted; authorized and unauthorized users attempt download | File rejected/quarantined, malware and sensitive data handled, retrieval access checked, expiration and deletion proven |
| VIT-AC-026 | OPS-003/004 | Reporter opts in for status, changes address or unsubscribes; delivery fails/retries | Verified channel/capability, consent-respecting redacted notifications, deduped retries, no unverified detail leaks |
| VIT-AC-027 | NFR-006/007/009 | Backend dependency unavailable, queue overloaded, restore performed or release rolled back | Alert and runbook exercised; no acknowledged reports lost under approved durability bounds; policies and measured recovery evidence recorded |
| VIT-AC-028 | NFR-008/010/011 | Provider API changes, schema migrates, a deletion request arrives after issue mirroring | Version negotiation/compatibility and data lineage verified; retention and downstream deletion policy actually enforced |

## P2: trends and trustworthy intelligence

| Scenario | Requirements | Given / when | Required result |
|---|---|---|---|
| VIT-AC-029 | VER-008, OPS-006/007/008 | New defect resembles old defect; agent code changes coincide with failure | Similarity reported with explicit confidence, alternate hypotheses and evidence; no unsupported causal claim; trend denominators disclosed |
| VIT-AC-030 | INT-011/012, UX-010 | Optional integrations/localization fail or newer provider contract unavailable | Existing reporter remains functional; graceful supported-state fallback; no unsupported migration |
| VIT-AC-031 | NFR-012, OPS-006/007 | Compare release cohorts or estimate rate/engineering cost | Missing data and coverage explicit; baselines and sample windows reported; no fabricated savings or universal success rates |

## Release readiness checklist

P0 should not be marked "ready" because a number of documents exist or the static report form has tests. Record the evidence of the following gates with exact source commits, tool runs, environment, timestamp and reviewer where policy requires it:

1. **Requirements authority**: P0 requirements reviewed; unresolved security/identity/data decisions addressed by a recorded decision or a bounded feature gate.
2. **Source and governance**: Conditor's generated installation is real, valid and version-pinned; Praxis/Ordo rules operate; no forged installation files.
3. **User workflow**: actual full submission and confirmation on the supported production path, including denial and recovery.
4. **Security/privacy**: real data residency/retention decision, moderation owner, access control and public/private boundary tested.
5. **Quality**: representative unit/integration/negative, concurrency, browser, keyboard/a11y and secret-safety tests; meaningful failing mutation evidence.
6. **Operational**: approved monitored backend, receipt durability, retry/dead-letter owner, tested failure behavior and safe alerting.
7. **Delivery**: GitHub Pages and custom domain DNS/TLS verified; deployment traceable to tested artifact; rollbacks planned.
8. **Communication**: reporters told precisely what receipt/status means; no promise of response or fixing without agreed policy.

## Scenario-to-implementation tracking

A scenario is one of: \`not-started\`, \`in-progress\`, \`blocked\`, \`executed-failed\`, \`verified-passed\`. A test file's presence, generated screenshot, or comment cannot by itself promote it to \`verified-passed\`. Evidence references must name immutable run, commit, environment and output. Current scenarios are **not verified by this document**.
