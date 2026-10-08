# Vitium current state

Date: 2026-10-08

**Canonical domain:** https://vitium.echelonfoundry.com/ (configured in source; DNS/Pages/HTTPS not verified).

## Implemented in the repository (as of mission VIT-P0-2026-10-08, branch `p0/integration`)

Local evidence only unless a CI run is cited. Full matrix: `docs/requirements/P0-TRACEABILITY.md`.

- **Genuine Conditor lifecycle installation** (Conditor 0.5.0; Praxis 3.7.2, Ordo 1.5.0, Visual Engineering 1.0.1, Communication Engineering 1.0.0) produced by real `conditor init`; `.conditor/lock.json` schema 4. CI-verified on `a8532cb`: [Conditor governance verification 37813042099](https://github.com/kemiller2002/vitium/actions/runs/37813042099) (attestation-verified installs, verify/doctor/status, no-drift) and [Praxis validation 37813042172](https://github.com/kemiller2002/vitium/actions/runs/37813042172).
- Reporter rebuilt on a pure state machine (`site/state.mjs`, `site/view.mjs`, `site/private-intake.mjs`): review/edit/cancel, accessible error summary, no silent truncation, credential guard before the GitHub handoff, private client gated off.
- Single machine-readable lifecycle table (`schemas/lifecycle/transitions.v1.json` 1.3.1, `ordoAuthorized: false`) enforced by JS (`service/lifecycle.mjs`, `service/triage.mjs`) and a pure F# core (`domain/`, FSharp.Core only); failed-verification rework loop, reopen-and-resume, provisional agent repair budget, human-verifier rule.
- Private intake hardened: typed failures, redaction + quarantine, NFC-hashed idempotent replay, challenge before conflict, 24 KiB cap, least-privilege SAM template candidate, operator CLI with fail-closed human-role classification and transactional observation→defect promotion.
- Proposed authenticated machine-observation contract (`service/machine/`, `schemas/machine/`), separate from the Turnstile route; no endpoint deployed.
- Release tooling: fail-closed Pages workflow, SHA-pinned actions, git-aware secret scan, read-only public-site verifier, runbooks and an operator decision register.
- Independent verification harness: Playwright/axe browser suite, adversarial suite, mutation appraisal (114 mutants).

## Not confirmed or not implemented

- **Not live.** `vitium.echelonfoundry.com` and `intake.vitium.echelonfoundry.com` return NXDOMAIN (witnessed 2026-10-08); repository `has_pages: false`; the Pages domain-verification TXT record is absent.
- No AWS deployment, real DynamoDB, Turnstile, IAM principal or log-redaction evidence; concurrency evidence is from the dynalite emulator only (and dynalite lacks TransactWriteItems).
- Lifecycle transitions are not under Ordo authority; F#/Limen/Forma 0.4.1 application migration (#6) not started (needs qualified Limen release set; NuGet blocked in the mission sandbox).
- Praxis work items are attributed but not checkpointed or completed (requires the pushed, reviewed state).
- Browser and axe checks passed in CI on PR #19 head `6be6d02` ([run 37856574275](https://github.com/kemiller2002/vitium/actions/runs/37856574275), real Forma CDN and blocked legs); a manual screen-reader session and a run against the canonical live site are outstanding.
- Open findings: VF-034 (needs a user decision, DOM-001 §29) and VF-018 (Forma SRI).
- Maintainer dashboard (#3), attachments (#4), machine producers (#14 P1), Arca/Fides integration.

## Immediate next action

Review and merge the P0 PRs; decide VF-034; then the operator gates in `docs/operations/OPERATOR-DECISIONS.md` (Pages/DNS/TLS D-01..D-05 first, then AWS staging, Turnstile, owners, retention, D-25 human operator roles). `site/public-config.mjs` stays `enabled: false` until those are evidenced.


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

## Mission VIT-P0-2026-10-08 results (2026-10-08)

- Seven specialist agents (governance, domain, intake/security, UX, release/ops, independent verification, build-system integrations) worked in isolated worktrees; the principal integrator merged in dependency order on `p0/integration` and attributed every specialist commit to Praxis work items VIT-P0-{GOV,DOM,INT,UX,OPS,VER,MACH,INTEG}-001.
- Local results at `a8a95f7`: `npm test` 310/310; adversarial 146 pass / 0 fail / 2 open findings; emulator integration 30/30; F# 25/25; browser 66/66 per CSS mode with 0 axe violations; secret scan 0; Conditor/Praxis/Ordo verification exit 0.
- The independent verifier raised VF-001..VF-036; 34 closed with failing-before/passing-after evidence, VF-034 contained pending user decision, VF-018 blocked.
- CI on PR #19 head `6be6d02`: quality gates, browser/adversarial, P0 service, Conditor governance, Praxis validation and NuGet build all succeeded (see `docs/requirements/P0-TRACEABILITY.md`).
- No acceptance scenario is `verified-passed`; P0 is an **engineering candidate**, not shipped.
