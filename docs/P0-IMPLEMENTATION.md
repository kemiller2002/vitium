# P0 implementation audit

Date: 2026-10-08
Status: **implementation candidate, not production-approved or deployed**

This file distinguishes code present from independently verified operation. Product requirements authority: [VITIUM-REQUIREMENTS.md](requirements/VITIUM-REQUIREMENTS.md). Echelon governance authority: [GOVERNANCE.md](GOVERNANCE.md).

## P0 delivery matrix

| P0 concern | Implementation | Verified evidence / outstanding gate |
|---|---|---|
| User can describe and review a defect | Existing semantic two-step site; legacy GitHub issue handoff | Node contract tests; real Playwright/mobile/accessibility checks still required (#2) |
| GitHub-free submission | Feature-gated private submission in site/app.mjs and site/public-config.mjs | Disabled by default; no live API, Turnstile key or private custom domain |
| Typed, versioned transport | service/report-domain.mjs, schemas/intake-request.schema.json | Client/server product-name compatibility and validation tests |
| Secure direct HTTPS API | service/http.mjs; AWS Lambda adapter, API Gateway SAM candidate | SAM build/validate in CI; actual AWS deployment, DNS, TLS, IAM audit and negative e2e required |
| Private durable receipt | Conditional DynamoDB PutItem/consistent GetItem with idempotency and opaque reference | Unit and simulated-store retry/outage/adversarial tests pass; real DynamoDB behavior not tested |
| Abuse and moderation | Single-use Cloudflare Turnstile verifier, limited payload, stage throttling, private queue; suspicious credentials refused | Turnstile live verification, IP-level controls, operator and abuse runbook missing; API Gateway throttle is global/best-effort |
| Observation vs defect and governance | Separate report/observation/defect contracts; service/triage.mjs transitions, explicit actor/reason/revision/evidence | Domain tests; Ordo integration and audited approved state policy outstanding (#8) |
| Initial private operator review | service/triage-cli.mjs uses AWS IAM identity and conditional DynamoDB updates; no public review route | Not tested with a real IAM principal/table; Fides-backed UI intentionally deferred |
| Security and privacy | No secrets in static frontend; challenge secret read via Secrets Manager; no anonymous read endpoint | Privacy notice, retention, data ownership, deletion, secret rotation and authenticated private review need operator approval (#13) |
| Echelon lifecycle governance | conditor.json, Conditor plan workflow, isolated installation preview | Read-only Conditor plan verified; actual installed files/lock, Praxis/Ordo evidence and F#/Limen migration not committed (#5,#6) |
| User confirmation/status | Receipt acknowledgement only after HTTP success; no fake "fixed" state | No live E2E. Anonymous status capability and notifications belong to later #12 |
| Machine observations from Echelon systems (#14) | service/machine-*.mjs, schemas/machine-observation.schema.json; separate authenticated route, never Turnstile | Unit tests for idempotency, scope, forgery, expiry, echo suppression, outbox outage/retry; no deployed endpoint, OIDC verifier, producer or real store |
| Failed-verification rework and reopening (#15) | service/triage.mjs, service/verification-proposals.mjs | Unit tests for multiple failed iterations, recurrence, self-certification, stale/out-of-order results, agent budget; Ordo authority outstanding |
| Production domain | vitium.echelonfoundry.com and proposed API intake.vitium.echelonfoundry.com | DNS/Pages/TLS must be configured, verified and continuously monitored (#7) |

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

Focus on #5 (actual Conditor lifecycle), #6 (non-destructive Echelon application migration) and #1 (staging integration proof) before adding P1 integrations or dashboards. The user can assess the source, tests and workflows now, but P0 must not be described as complete until the blockers above are resolved.
