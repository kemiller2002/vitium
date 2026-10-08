---
id: VIT-P0-TRACE
title: Vitium P0 requirements traceability
status: evidence-record
mission: VIT-P0-2026-10-08
created: 2026-10-08
owner: principal-integrator
---

# P0 traceability

This maps every **P0** requirement in [VITIUM-REQUIREMENTS.md](VITIUM-REQUIREMENTS.md) (34 rows, including the four P0 rows added on 2026-10-08: VIT-LCY-010, VIT-LCY-011, VIT-VER-009, VIT-INT-013) to source, tests, owner, issue, evidence and status. Requirements remain **proposed**; nothing here approves them.

## Status vocabulary

- **implemented / local** — code and tests exist and were executed and passing in the mission sandbox at the evidence commit. Not production evidence.
- **partial** — some of the requirement is implemented and tested; the remainder is named.
- **blocked** — cannot be completed without the named external action or decision.
- **not started**.

Acceptance scenarios use the states defined in [VITIUM-ACCEPTANCE.md](VITIUM-ACCEPTANCE.md); the independent verifier's per-scenario authority is [P0-THREAT-TEST-MATRIX.md](../verification/P0-THREAT-TEST-MATRIX.md) ("FINAL ledger, fix round 5"). **No scenario is `verified-passed`.**

## Evidence baseline

All local results below were observed on branch `p0/integration` at commit `a8a95f7` (before this document's commit) in the mission sandbox (Linux, Node 22.22.0, .NET SDK 8.0.425, sparticuz Chromium 153 with the Forma CDN blocked and with the pinned Forma 0.3.0 file served locally, DynamoDB **emulator** dynalite 4.0.0).

| Command | Result |
|---|---|
| `npm test` | 310 tests, 310 pass, 0 fail |
| `npm run test:adversarial` | 148 tests, 146 pass, 0 fail, 2 todo (open findings VF-018, VF-034) |
| `npm run test:integration` (dynalite emulator, not AWS) | 30 / 30 pass |
| `dotnet run --project domain/Vitium.Domain.Tests` | 25 / 25 pass, 12 table mutants checked; build 0 warnings |
| `npm run test:browser` (verifier, both CSS modes) | 66 / 66 per mode; axe 0 violations; no horizontal scroll at 320/375/1280 |
| `node scripts/secret-scan.mjs .` | 0 blocked |
| `conditor verify`, `conditor doctor --json`, `praxis verify --strict`, `ordo verify --integrity-only`, `./praxis registry check`, `./praxis validate` | all exit 0, tree unchanged |
| Mutation appraisal (verifier, 114 mutants) | 108 killed; 6 survivors, all judged equivalent (M23, M38, M43, M48, M57, R309) |

CI evidence witnessed so far (GitHub Actions, REST API):

| Run | Workflow | Commit | Result |
|---|---|---|---|
| [37813042099](https://github.com/kemiller2002/vitium/actions/runs/37813042099) | Conditor governance verification (attestation-verified Conditor/Praxis/Ordo install, verify/doctor/status, no-drift check, governance tests) | `a8532cb` | success, every step |
| [37813042172](https://github.com/kemiller2002/vitium/actions/runs/37813042172) | Praxis validation | `a8532cb` | success |

CI on PR #19 head `6be6d02` (all success, observed 2026-10-08):

| Run | Workflow | Covers |
|---|---|---|
| [37856574261](https://github.com/kemiller2002/vitium/actions/runs/37856574261) | Vitium quality gates | `npm test`, secret scan, `test:adversarial`, F# domain build + tests (SDK 8 pinned) |
| [37856574275](https://github.com/kemiller2002/vitium/actions/runs/37856574275) | Vitium browser and adversarial verification | Playwright/axe suite, both **cdn** (real Forma CDN) and **blocked** legs |
| [37856574333](https://github.com/kemiller2002/vitium/actions/runs/37856574333) | Vitium P0 service and infrastructure | `npm ci`, unit + emulator integration tests, syntax check, `sam validate`/build |
| [37856574294](https://github.com/kemiller2002/vitium/actions/runs/37856574294) | Conditor governance verification | attestation-verified installs, verify/doctor/status, no drift |
| [37856574326](https://github.com/kemiller2002/vitium/actions/runs/37856574326) | Praxis validation | registry check, work attribution |
| [37856574291](https://github.com/kemiller2002/vitium/actions/runs/37856574291) | Vitium NuGet build and pack | main's F# packages still build after integration |

These are CI results for source and emulator checks. They are not evidence of a deployment, real AWS behaviour, or a live site.

## Requirements

| ID | Owner (agent) | Source | Tests / evidence | Issue | Status |
|---|---|---|---|---|---|
| VIT-UX-001 | ux, ops | `site/index.html`, `site/app.mjs`; canonical tag | `tests/site-page.test.mjs`; browser suite; `scripts/verify-public-site.mjs` | #2 #7 | **blocked**: canonical host has no DNS record (NXDOMAIN, witnessed 2026-10-08) and Pages is not enabled (D-01..D-05) |
| VIT-UX-002 | ux, domain | `site/submission.mjs`, `site/state.mjs`, `schemas/products.v1.json` | `tests/submission.test.mjs`, `tests/site-state.test.mjs`, `tests/domain-registry.test.mjs` | #2 | implemented / local |
| VIT-UX-003 | ux | `site/state.mjs`, `site/view.mjs` review/edit/cancel | `tests/site-state.test.mjs`; browser suite | #2 | implemented / local (retention notice states the policy is not yet published — VIT-OQ-009) |
| VIT-UX-004 | ux, intake | `site/state.mjs`, `site/private-intake.mjs` `parseReceipt` | `tests/site-state.test.mjs`, `tests/p0-contract.test.mjs` (behavioural, 3 mutants killed) | #1 #2 | implemented / local; live path disabled |
| VIT-UX-005 | intake, ux | `service/intake.mjs` receipt, `site/private-intake.mjs` | `tests/intake-core.test.mjs`, `tests/site-intake-contract.test.mjs` | #1 | partial: works against emulator; no deployed endpoint (blocked on AWS staging) |
| VIT-UX-006 | ux, verify | semantic markup, focus management, reduced motion | browser suite (320/375/1280, keyboard-only, axe, reduced motion); CI run 37856574275 (cdn + blocked) | #2 | partial: CI-witnessed browser checks; manual screen-reader session and canonical-site run outstanding |
| VIT-UX-007 | ux | over-limit messaging without truncation (VF-003), values kept on error | `tests/site-state.test.mjs`; browser suite | #2 | implemented / local |
| VIT-DOM-001 | domain | `service/domain-records.mjs`, `domain/Vitium.Domain/*.fs` | `tests/domain-*.test.mjs`; F# runner | #8 | implemented / local |
| VIT-DOM-002 | domain, intake | opaque `VIT-` reference, `DEF-` ids | `tests/intake-core.test.mjs`, domain tests | #8 | implemented / local |
| VIT-DOM-003 | domain | v2 schemas, `migrate`, shared report/transition cases | `tests/domain-migration.test.mjs`, `tests/domain-report-contract.test.mjs`, adversarial schema/runtime parity | #8 | implemented / local (one documented schema-inexpressible case, DOM-001) |
| VIT-DOM-004 | domain | `schemas/products.v1.json`, `service/product-registry.mjs` | `tests/domain-registry.test.mjs`; site/service/registry divergence test | #8 | implemented / local |
| VIT-DOM-005 | domain, machine | provenance classes; trusted `context`; verified principal | domain + `tests/machine-auth.test.mjs` | #8 #14 | implemented / local |
| VIT-DOM-006 | domain | separate impact/severity/priority/confidence | domain tests | #8 | implemented / local |
| VIT-API-001 | intake, ux, ops | `service/http.mjs`, `infra/aws/template.yaml`; no secrets in client | `tests/intake-*.test.mjs`, `tests/secret-scan.test.mjs` | #1 | **blocked**: no deployed HTTPS endpoint (AWS account, Turnstile, intake DNS — D-07..D-19) |
| VIT-API-002 | intake, domain | `service/limits.mjs`, byte cap before parse, `report-domain.mjs` | intake + adversarial suites | #1 | implemented / local |
| VIT-API-003 | intake | quarantine, size bounds, malformed-token pre-filter, stage throttle | `tests/intake-*.test.mjs` | #1 | partial: global throttle only; per-source limit needs WAF/topology decision (R-03) |
| VIT-API-004 | intake | conditional put, NFC hash, replay without re-challenge, challenge before conflict | `tests/intake-replay.test.mjs`, `tests/intake-oracle.test.mjs`, emulator I-01..I-09 | #1 | partial: **emulator** concurrency evidence only; real DynamoDB untested (R-01) |
| VIT-API-005 | intake | `service/errors.mjs` typed categories | intake tests, `tests/site-intake-contract.test.mjs` | #1 | implemented / local |
| VIT-API-006 | ops | `docs/operations/DATA-HANDLING.md` skeleton | `tests/release-operations-docs.test.mjs` (forbids invented values) | #13 | **blocked**: retention, deletion, DSR owner undecided (VIT-OQ-008/009) |
| VIT-API-007 | intake, ops | redaction + quarantine + security flag; escalation runbook skeleton | `tests/intake-canary.test.mjs` | #1 #13 | partial: no named escalation recipient (VIT-OQ-008) |
| VIT-LCY-001 | domain | `schemas/lifecycle/transitions.v1.json` 1.3.1 → JS `service/lifecycle.mjs` and F# | exhaustive (from,to) matrix in JS and F#, 60 shared cases + 15 cycles | #8 | implemented / local; **not Ordo-authorized** (`ordoAuthorized: false`) |
| VIT-LCY-002 | domain, intake | promotion creates a new linked defect; `triage-cli promote` transaction | domain tests; emulator I-30..I-35 (TransactWriteItems via labelled shim — dynalite lacks it) | #8 | partial: real transaction atomicity untested |
| VIT-LCY-003 | domain | classification fields, role guards | domain tests | #8 | implemented / local |
| VIT-LCY-004 | domain | typed terminal dispositions with reason/evidence; reopen | domain tests; adversarial lifecycle | #8 | implemented / local |
| VIT-LCY-010 | domain, intake | failed verification → in-progress with verifier, attempt, candidate, evidence; repair budget | Kevin's `tests/triage.test.mjs` + `tests/state-contract.test.mjs` (unedited, pass); `tests/domain-verification-cycle.test.mjs`; emulator I-20, I-34 | #15 | implemented / local; see VF-034 |
| VIT-LCY-011 | domain, intake | resolved/closed → reopened → in-progress/reproducing; atomic reopen-and-resume | same; emulator I-21 | #15 | implemented / local |
| VIT-INT-001 | ux | legacy GitHub handoff, credential guard (VF-004) | browser suite (external requests aborted), `tests/site-credential-parity.test.mjs` | #2 | implemented / local |
| VIT-INT-013 | machine | `service/machine/*`, `schemas/machine/observation-envelope.v1.schema.json` | `tests/machine-*.test.mjs` (53), adversarial machine suites | #14 | implemented / local as a **proposed contract**; no endpoint, no producer (P1) |
| VIT-VER-009 | domain | outcome/attempt match, author independence, human verifier for pass (provisional) | domain + adversarial verification-cycle suites | #15 | partial: **VF-034** open — the legacy `transition()` used by Kevin's tests lets one actor submit and pass; contained (DOM-001 §29), needs a user decision |
| VIT-NFR-001 | governance | real `conditor init` output, `.conditor/lock.json` (schema 4) | local verify/doctor exit 0; CI run 37813042099 | #5 | implemented; CI-witnessed on `a8532cb` |
| VIT-NFR-002 | governance, integrator | Praxis 3.7.2 / Ordo 1.5.0 installed; work items VIT-P0-{GOV,DOM,INT,UX,OPS,VER,MACH,INTEG}-001 | `./praxis validate`; CI run 37813042172 | #5 | partial: work items attributed but not checkpointed/completed (Praxis requires pushed state); lifecycle transitions not under Ordo authority |
| VIT-NFR-003 | ops | `pages.yml` fail-closed, `scripts/verify-public-site.mjs` | `tests/release-*.test.mjs` | #7 | **blocked**: D-01..D-05 (Pages, domain verification TXT, CNAME, HTTPS) |
| VIT-NFR-004 | ops, intake | git-aware secret scan; log/response/store canary | `tests/secret-scan.test.mjs`, `tests/intake-canary.test.mjs` | #13 | partial: deployed-log redaction needs a staging Lambda |
| VIT-NFR-005 | ops | `docs/operations/OPERATOR-DECISIONS.md` (D-01..D-25, M-01..M-10, all UNASSIGNED) | doc tests forbid invented owners | #13 | **blocked**: owners not named (VIT-OQ-008) |

## P0 acceptance scenarios (verifier's final ledger)

| Status | Scenarios |
|---|---|
| verified-passed | none |
| executed-failed | none |
| in-progress | 002, 004, 009, 010, 011, 012, 013, 032, 033, 034, 035, 036 |
| blocked | 001, 003, 005, 006, 007, 008, 014, 015 |

## Mission §7 gates

| Gate | Status | Evidence / remaining |
|---|---|---|
| Machine producer contract and identity model; untrusted provider claims denied | in-progress | MACH-001; forged principals, scope confusion, spoofed echo markers refused (verifier rounds 3–5). No real producer |
| Two or more failed iterations before a pass, and a later recurrence | in-progress | shared cycles in JS + F#; emulator I-20, I-34, I-21 |
| Evidence and candidate history survive failure and reopening | in-progress | frozen append-only history; byte-identical prior evidence checks |
| Autonomous repair bounded, escalates | in-progress | provisional budget (3, marked `provisional`); VF-027/VF-035 closed; requires operator role list D-25 |
| No claim of deployed producers, machine API or Ordo authority | holds | nothing deployed; `ordoAuthorized: false`; `site/public-config.mjs` `enabled: false` |

## Open findings

| ID | Severity | Owner | State |
|---|---|---|---|
| VF-034 | medium | domain + **user decision** | contained; options in DOM-001 §29: (a) give Kevin's legacy tests distinct submitter/verifier actors, or (b) retire the legacy `transition()` |
| VF-018 | medium | ux / ops | blocked: compute SRI for the jsDelivr Forma stylesheet from a network that can reach it (UX-0001) |

All other findings VF-001..VF-036 are closed with closing commits recorded in [EVIDENCE-APPRAISAL.md](../verification/EVIDENCE-APPRAISAL.md).
