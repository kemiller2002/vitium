# Vitium current state

Date: 2026-10-08

**Canonical domain:** https://vitium.echelonfoundry.com/ (configured in source; DNS/Pages/HTTPS not verified).

## Implemented in the repository

- Public, responsive, two-step reporting form in `site/index.html`.
- Deterministic validation, normalization, sanitized page URL and GitHub issue prefill in `site/submission.mjs`.
- Review-before-GitHub step; form explicitly states that submission happens on GitHub.
- Pinned Forma 0.3.0 CSS consumption via CDN.
- A versioned internal defect JSON Schema.
- Node unit tests for the report normalization/link contract.
- GitHub Actions files for CI tests and GitHub Pages deployment.
- Conditor lifecycle manifest declared, not installed or verified.
- Echelon governance and migration contract documented.

## Not confirmed or not implemented

- GitHub Pages Settings must configure custom domain `vitium.echelonfoundry.com` and GitHub Actions as source. DNS CNAME and HTTPS still require setup/verification.
- Conditor needs a real tool-run installation and verified lock; no lifecycle installation is evidenced.
- Forma 0.3.0 CSS in the current frontend has not yet been proved a valid pinned deployed asset or upgraded to the Echelon 0.4.1 target. The JavaScript form must migrate to the Conditor-managed F#/Limen application baseline.
- Node quality gates and the P0 AWS SAM validation/build workflow have been observed successful; this is **not** a live deployment.
- The Conditor read-only plan and isolated installation preview were verified in CI; the preview's generated governance state has not been committed to the repository.
- Browser automation, axe a11y verification and screenshots are not yet executed.
- Direct submission without GitHub has a **feature-gated implementation candidate**, not a deployed or enabled service (issue #1).
- Full browser and assistive-tech verification (issue #2).
- Maintainer triage application (issue #3).
- Safe attachments (issue #4).
- Arca storage, Fides internal login, Dokimos intake, Praxis remediation and Ordo lifecycle integration.

## Immediate next action

Execute and verify Conditor installation from the manifest, follow the scaffold migration plan in `docs/GOVERNANCE.md`, configure `vitium.echelonfoundry.com` per `DEPLOYMENT.md`, and pass all tests before calling the site live. For reporting without GitHub accounts, implement issue #1 first.


## Observed automation evidence (2026-10-08)

- [Vitium quality gates run 37758370262](https://github.com/kemiller2002/vitium/actions/runs/37758370262) completed successfully at commit `a8cf7364f2265c680c70f02c24c8a8728f7ccfcc`.
- [Vitium public site run 37758370436](https://github.com/kemiller2002/vitium/actions/runs/37758370436) **failed**: Node test step completed **13 tests, 13 passed, 0 failed**, but `actions/configure-pages@v5` returned `Get Pages site failed ... Not Found`. The logs explicitly instruct enabling Pages for GitHub Actions in repository settings. Upload and deploy were skipped.
- Do not call the site deployed or the HTTPS custom hostname live based on passing Node tests. Real browser, DNS, TLS and deployment remain **unverified**.
- GitHub Actions lacks sufficient special token privileges to bootstrap Pages via `enablement:true` with its default `GITHUB_TOKEN`. Operator must enable Pages first; do not add a secret merely to hide the settings requirement.

## Requirements audit (2026-10-08)

- Proposed complete product-scope requirements drafted in `docs/requirements/VITIUM-REQUIREMENTS.md` (**92 requirements**, 8 groups, P0/P1/P2); not approved or verified as implemented.
- `docs/requirements/VITIUM-ACCEPTANCE.md` proposes **36 scenarios** with positive, negative, privacy, concurrency, integration and release-readiness checks. No end-to-end scenarios are claimed to have passed.
- `docs/requirements/VITIUM-OPEN-DECISIONS.md` records **18 open product/architecture/security decisions**. No authorizations or operator commitments have been assumed.
- Issues #8–#15 now track domain modeling, embedded reporting, source synchronization, regression evidence, reporter follow-up and production operations in addition to the original #1–#7.
- Static requirements integrity checks were added to `npm test`; those checks prove the written baseline is internally structured, **not** that behavior has been built or independently verified.

## P0 implementation slice (2026-10-08)

- New `service/report-domain.mjs`, `service/intake.mjs`, `service/http.mjs`, and `service/aws-handler.mjs`: versioned, strict private observation intake, anti-bot challenge boundary, conditional DynamoDB idempotency and safe receipt.
- `service/triage.mjs` and `service/triage-cli.mjs`: pure authorization/transition guards and provisional internal AWS IAM operator CLI (no public triage endpoint).
- New typed report-request/observation JSON schemas and adversarial unit tests for malformed input, origins, challenge failure, storage failure, replay and revision conflicts.
- `infra/aws/template.yaml`: CI-validating/building infrastructure candidate with private DynamoDB table, staged throttling and Secrets Manager role. No deployment has been run.
- Frontend includes private-mode challenge and receipt flow, **disabled** in `site/public-config.mjs` pending verified endpoint and operator policy.
- Conditor's v0.5.0 read-only plan passed in [Actions](https://github.com/kemiller2002/vitium/actions/runs/37771531737). The first isolated installation previews exposed native-launcher packaging problems; the corrected isolated install/verify/doctor preview passed in [Actions run 37772428835](https://github.com/kemiller2002/vitium/actions/runs/37772428835). Its generated governance files have not been committed to the repository.
- P0 acceptance is **blocked** on Cloudflare/AWS provisioning, data retention and moderation ownership, F#/Limen architecture migration, genuine Conditor installation, access review, live integration/browser evidence, and Pages/DNS/TLS.
- Detailed P0 scope and blockers: `docs/P0-IMPLEMENTATION.md`.

## Claude P0 handoff (2026-10-08)

- Reusable multi-agent Claude Code execution mission: `docs/agent-scripts/CLAUDE-VITIUM-P0.md`.
- Observed latest Conditor isolated installation preview: [run 37772428835](https://github.com/kemiller2002/vitium/actions/runs/37772428835), successful including lifecycle verification and reviewable diff. Preview success is **not** a committed Conditor installation.
- Work starts with integrating the genuine generated Conditor state without overwriting Vitium's existing form, then a safe typed F#/Limen migration, private intake verification, independent browser/security evidence and an accurate external-operator blocker report.

## Build-system reporting and verification-loop scope (2026-10-08)

- Machine producer intake from Praxis/Ordo/Conditor/Dokimos/Tutela/Aegis/CI is now specifically documented in `docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md` with P0 contract obligations and P1 producer rollout; tracked in #14. **No authenticated machine intake service or upstream emitter has been shipped.**
- Repair → failed independent verification → in-progress → rework → verification → resolved and resolved/closed → reopened → active repair are explicitly specified. The local candidate `service/triage.mjs` and tests now require verifier, outcome, candidate revision, evidence, attempt ID and reopen release metadata. Tracked in #15.
- The state-helper tests are not proof of integrated Ordo transition governance or end-to-end Praxis remediation.

## Vitium NuGet packages (2026-10-08)

- Added F#/.NET 10 package projects `src/Vitium.Contracts` (`EchelonFoundry.Vitium.Contracts`) and `src/Vitium.Client` (`EchelonFoundry.Vitium.Client`) at version `0.1.0-preview.1`.
- `Vitium.slnx`, F# consumer smoke tests, `nuget-ci.yml` compile/pack workflow and a guarded manual OIDC NuGet publishing workflow are present.
- Actual CI [run 37817505596](https://github.com/kemiller2002/vitium/actions/runs/37817505596) **succeeded**, including build, typed transport checks, both `.nupkg` artifacts, and restoration/compilation from packages in an unrelated F# consumer.
- Packages are **not published** to NuGet.org or deployed to any application. MIT has been approved and added to the repository `LICENSE` and both F# NuGet project files. The NuGet package owner is `Kevin.m.miller` with Trusted Publishing policy `kemiller2002/vitium`, `nuget-publish.yml`, environment `nuget-release`, glob `EchelonFoundry.Vitium.*`. Publication still needs a matching immutable version tag, GitHub environment setup/protection, and a real successful OIDC publishing run. See `docs/NUGET-PACKAGES.md`.
- The client models machine observation and verification submission with short-lived bearer credentials, but a live machine intake server, durable producer outbox, approved service identity and actual Praxis integration remain open (#14, #15).

## Machine reporting and rework lifecycle implementation candidate (2026-10-08, #14/#15)

- **Implemented in source, unit-tested only:** strict machine-observation envelope v1.0 (`service/machine-observation.mjs`, `schemas/machine-observation.schema.json`), short-lived workload identity binding and scope checks (`service/machine-auth.mjs`), idempotent authenticated intake with conflict detection, restricted routing of security findings and Vitium echo suppression (`service/machine-intake.mjs`), a browser-refusing HTTP boundary for `POST /api/v1/observations` (`service/machine-http.mjs`), a bounded producer outbox that never alters the producer's build result (`service/machine-outbox.mjs`), and machine-result **proposals** that only an independent verifier can apply (`service/verification-proposals.mjs`).
- `service/triage.mjs` now enforces: independent verifier (submitter cannot certify), a recorded submission before any verification result, distinct attempt IDs, chronological order, inconclusive results with explicit cause that neither resolve nor count as failures, an agent failed-attempt budget with human escalation, derived links from reopenings to the superseded resolution, and atomic `reopenAndResume`. Provisional choices: `docs/decisions/VIT-ADR-001-machine-observations-and-rework-lifecycle.md`.
- Tests: `npm test` covers the build-system spec's required tests 1–8 at unit level, including two failed verifications before a pass and a later recurrence. Each guard was checked by deliberately breaking it (mutation) and confirming a test fails.
- **No authenticated machine intake service or upstream emitter has been deployed.** The machine route is deliberately absent from `infra/aws/template.yaml`; token signature verification is an injected effect with no qualified implementation; no Praxis/CI/Dokimos producer sends events; storage behavior is proven only against an in-memory store. Spec test 9 (audited transitions under qualified Ordo) is blocked on the Conditor installation.
- Traceability: `docs/requirements/P0-TRACEABILITY.md`.
- **Client/server contract alignment (after merging `main`'s F# packages):** the F# `VitiumClient` initially could not report to this server at all (its `+00:00` timestamps were refused with HTTP 400), every receipt was rejected as `invalid_receipt`, and `/api/v1/verification-results` had no server. Fixed on both sides (ADR decisions 21–24). `tests/interop/run.sh` now runs the real F# client against the real JS handler over loopback HTTPS (8 scenarios, passing locally with .NET 10.0.401 and Node 22) and is wired into `nuget-ci.yml`. It is wire-compatibility proof only; no endpoint is deployed.
