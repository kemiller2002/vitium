# P0 implementation audit

Date: 2026-10-08
Status: **engineering candidate (mission VIT-P0-2026-10-08), not production-approved or deployed**

This file distinguishes code present from independently verified operation. Product requirements authority: [VITIUM-REQUIREMENTS.md](requirements/VITIUM-REQUIREMENTS.md). Echelon governance authority: [GOVERNANCE.md](GOVERNANCE.md).

## P0 delivery matrix (updated by mission VIT-P0-2026-10-08)

Requirement-level detail and evidence: [requirements/P0-TRACEABILITY.md](requirements/P0-TRACEABILITY.md). Local = executed in the mission sandbox at `a8a95f7`.

| P0 concern | Implementation | Verified evidence / outstanding gate |
|---|---|---|
| User can describe and review a defect | Pure state machine reporter; review/edit/cancel; accessible errors; legacy GitHub handoff with credential guard | Local unit + browser (320/375/1280, keyboard, axe 0 violations); CI browser run and screen-reader session outstanding (#2) |
| GitHub-free submission | Typed private client, disabled in `site/public-config.mjs` | Contract tests against the real handler; no live endpoint, Turnstile key or intake domain |
| Typed, versioned transport | `service/limits.mjs`, `service/errors.mjs`, v2 schemas, shared case files, schema/runtime parity | Local; one documented schema-inexpressible case (DOM-001) |
| Secure direct HTTPS API | Thin HTTP adapter; byte cap before parse; least-privilege SAM candidate (staging origin parameter, deletion protection, no CLI in package) | cfn-lint locally; `sam validate`/build in CI; deployment, DNS, TLS, IAM audit outstanding |
| Private durable receipt | Conditional put, NFC payload hash, replay without re-challenge, challenge before conflict | **Emulator** (dynalite) concurrency evidence; real DynamoDB untested |
| Abuse and moderation | Redaction + quarantine + security flag; malformed-token pre-filter; global stage throttle | Per-source throttling needs WAF/topology decision; moderation owner unassigned |
| Observation vs defect and lifecycle | One table (`transitions.v1.json` 1.3.1) in JS + F#; transactional promotion; failed-verification loop; reopen-and-resume; repair budget; human verifier for pass | Local JS + F# + emulator; **not Ordo-authorized**; VF-034 needs a user decision |
| Operator review | `triage-cli.mjs` strict path; fail-closed human-role classification (`VITIUM_HUMAN_OPERATOR_ROLE_ARNS`, no default) | Emulator only; role list is operator decision D-25 |
| Machine observations (VIT-INT-013) | Proposed authenticated envelope, branded verified principal, principal-scoped idempotency, echo suppression, outbox policy | Local core tests; no endpoint or producer (P1, M-01..M-10) |
| Security and privacy | No secrets in client; git-aware secret scan; log/response/store canary | Retention, deletion, DSR, escalation owner undecided (VIT-OQ-008/009) |
| Echelon lifecycle governance | Real Conditor installation committed; CI verifies committed state | CI runs 37813042099 and 37813042172 (success on `a8532cb`); Praxis work items not yet completed |
| Production domain | Fail-closed Pages workflow; read-only site verifier | NXDOMAIN; Pages not enabled (D-01..D-05) |

## What tests establish

- Node test workflows establish the unit and structural contract checks on the committed source. They do not establish production end-to-end behavior or full accessibility.
- SAM build in CI establishes that the template is accepted by the CI toolchain and produces a candidate Lambda artifact. It is not proof the AWS stack deploys or the resulting service can handle live reports.
- Conditor read-only planning establishes a compatible declared bootstrap plan. It is **not** tool installation, a verified lock, or a complete F#/Limen application.
- The frontend will only attempt private intake when site/public-config.mjs is **explicitly configured** with a canonical HTTPS endpoint and public Turnstile site key. Until then GitHub remains the only submission endpoint.
- All new records are private observations pending triage. No anonymous reporter creates a confirmed defect or a public GitHub issue via the service.

## Release blockers that cannot be faked

1. Name responsible organization/operator, moderation owner and escalation contact.
2. Resolve and approve storage region, retention/deletion, secure contact/status scope, privacy notice, credential ownership, and anonymous-abuse policy (VIT-OQ-001..009).
3. Deploy and test AWS staging with Turnstile + DynamoDB. Perform concurrency, replay, timeout, transaction, privilege and secret-leakage tests against real AWS.
4. Finish Conditor installation using the actual CLI; persist genuine tool-owned generated files, Praxis/Ordo governance and validate them in CI.
5. Migrate the transitional JavaScript intake implementation to the qualified Echelon F#/Limen/Arca application contract or obtain an explicit temporary architecture exception. This JS implementation is a **functional staging adapter**, not approved final architecture.
6. Run real Playwright browser/keyboard/axe/a11y and failure-mode tests against the configured staging API, then confirm custom DNS/HTTPS.
7. Only after those gates, enable private intake via public configuration and record an actual durable end-to-end receipt, deployment artifacts and rollback drill.

## Next engineering slice

1. Review/merge the P0 PRs and observe CI on the merged head.
2. User decision on VF-034 (DOM-001 §29).
3. Operator gates: Pages/DNS/TLS, then AWS staging with Turnstile and the staging E2E list in `docs/operations/STAGING-READINESS.md` (real DynamoDB concurrency, transactions, IAM, log redaction).
4. Ordo review of `transitions.v1.json` before it is called transition authority; qualified Limen/Forma release set for the F# application migration (#6).
5. P1: authenticated machine endpoint and one Praxis + one CI/Dokimos producer (#14) after M-01..M-10.

P0 must not be described as complete until the blockers above are resolved.
