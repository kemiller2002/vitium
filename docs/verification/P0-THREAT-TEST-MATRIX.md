# Vitium P0 threat / test matrix

Status: **phase-1 independent verification against baseline `main` @ `bba1d59`**. Branch `p0/verification-harness`.
Author role: independent verification agent (VIT-P0-2026-10-08). This document does **not** certify code written by other agents and promotes **no** scenario to `verified-passed`: every P0 scenario below also depends on deployment, operator or governance evidence that does not exist.

Status vocabulary follows `docs/requirements/VITIUM-ACCEPTANCE.md`: `not-started`, `in-progress`, `blocked`, `executed-failed`, `verified-passed`. A check line can be `executed-pass`, `executed-fail (finding)` or `not-executed`.

## Final status, fix round 4 (confirmation pass, `p0/fix4-verify` from `p0/integration` @ `ef8f359`)

This section supersedes the round-3 and earlier tables below.

**Local environment:** as in round 3 (sandbox, Node v22.22.0; Chromium 153.0.8010.0 via `@sparticuz/chromium@153.0.0` and `@playwright/test@1.63.0`; Forma CDN blocked, plus file mode; dynalite for integration).

**CI:** Conditor governance verification run 37813042099 and Praxis validation run 37813042172 succeeded on `a8532cb` (ancestor of `ef8f359`); both were re-checked via `gh api`. **No CI run of `ef8f359` itself has been witnessed.**

### Commands and outputs (`ef8f359` + this branch's test/doc changes)

| Command | Output |
|---|---|
| `npm test` | 298 tests, 298 pass, 0 fail, 0 todo |
| `npm run test:adversarial` | 142 tests, 138 pass, 0 fail, 4 todo (VF-018, VF-034, VF-035, VF-036) |
| `npm run test:integration` | 30 tests, 30 pass (dynalite) |
| `node scripts/secret-scan.mjs` | `[git]` 323 text files, 0 blocked |
| Browser, CDN blocked | 66 passed, 0 failed, 0 flaky; axe 0 violations; no overflow |
| Browser, Forma file mode | 66 passed, 0 failed; axe 0 violations |
| Mutation appraisal, 102 mutants, unit + adversarial + integration (+ R304 re-run) | 96 killed; 6 survivors, all equivalent (M23, M38, M43, M48, M57, R309) |

### Final finding status

| ID | Status | Closing commit / owner |
|---|---|---|
| VF-001..VF-017, VF-019..VF-024 | closed | see earlier rounds (VF-024 with the residual recorded in SEC-001) |
| VF-018 | open, blocked | ux / ops; needs the jsDelivr byte check from an unblocked network |
| VF-025 | closed (variant via legacy shape also refused, `author_mismatch`) | cc67767 / 41ad546 |
| VF-026 | closed (homoglyph, zero-width, full-width and non-ASCII-hyphen aliases refused at `ActorId`; case variants canonicalised) | cc67767 |
| VF-027 | closed for the lifecycle API (no context + asserted human is still budgeted; contradicting context → `provenance_conflict`) | cc67767; **boundary residual → VF-035** |
| VF-028 | closed for strict paths (agent/ci/application contexts → `human_verifier_required`) | cc67767; **legacy-path residual → VF-034** |
| VF-029 | closed (nested evidence items, subject and correlation inherited keys refused; nothing stored) | 418b86f |
| VF-030 | closed (casing variants fail the pattern; `vitium/…` from a non-Vitium principal → `spoofed_echo_marker`) | 418b86f |
| VF-031 | closed (other principal → `event_conflict` with an identical response for same or different content; upper-case eventId invalid) | 418b86f |
| VF-032 | closed (inconclusive leaves the attempt open; a second conclusive result is still `attempt_conflict`) | 418b86f |
| VF-033 | closed when the producer principal is known | 418b86f; **unknown-principal residual → VF-036** |
| **VF-034** | **open (new)** | domain: legacy `tryTransition` lets one actor submit and pass (independence skipped for `unrecorded`), and lets any actor pass (human-verifier rule skipped for `unrecorded`). No service code calls it today (DOM-001 §25/§28 tolerate it for Kevin's authority tests), but it is an exported entry point. |
| **VF-035** | **open (new)** | domain / ops: `triage-cli` maps every IAM principal to `authenticated-human`, so an agent workload's assumed-role session is exempt from the repair budget and the human-verifier rule. Fix: derive provenance from an IAM role allow-list or tag (human operator roles only), or refuse non-human sessions. |
| **VF-036** | **open (new, low)** | machine: an outbox entry without a known `principalId` accepts an ack issued to any principal. Fix: require the producer principal at enqueue, or treat a principal-less ack as unconfirmed. |

### Per-scenario status (VIT-AC-001..015, 032..036)

No scenario is `verified-passed`.

| Scenario | Status | Local evidence (`ef8f359`) | Blocking |
|---|---|---|---|
| VIT-AC-001 | blocked | Browser suite passes in both CSS modes (keyboard, focus, error summary, overflow, axe 0) | Canonical site (AC-014); manual screen-reader session; CI browser leg |
| VIT-AC-002 | in-progress | Legacy flow and safe GitHub link; no requests escape | CI browser leg; canonical site |
| VIT-AC-003 | blocked | Wire body accepted; gate off | AWS staging, Turnstile, intake domain, operator approval |
| VIT-AC-004 | in-progress | All validation and hostile-input tests pass; VF-011 closed | CI leg |
| VIT-AC-005 | blocked | Challenge before write; pre-filter | Per-source throttling; load test on AWS |
| VIT-AC-006 | blocked | Idempotency, conflict and lost-response retry pass locally and on dynalite | Real DynamoDB |
| VIT-AC-007 | blocked | No receipt on store failure | AWS staging; GitHub sync (P1) |
| VIT-AC-008 | blocked | Redaction, quarantine, site parity | Designated operator (VIT-OQ-008) |
| VIT-AC-009 | in-progress | Unchallenged conflict byte-identical to an unused key; no read route | CI leg (M57 equivalent) |
| VIT-AC-010 | in-progress | Product/impact parity; registry tests | Registry tests not independently adjudicated; CI leg |
| VIT-AC-011 | in-progress | No observation → defect edge; transactional promote | Ordo/Fides; real DynamoDB TransactWriteItems |
| VIT-AC-012 | in-progress | Table-driven lifecycle suite passes | Candidate authority; CI leg |
| VIT-AC-013 | in-progress | n/a locally | **CI witnessed**: runs 37813042099 and 37813042172 on `a8532cb`; qualified Ordo transition authority not claimed |
| VIT-AC-014 | blocked | n/a | Operator Pages/DNS/TLS |
| VIT-AC-015 | blocked | Git-aware scan 0; no secrets in assets or responses | Lambda log canary; VF-018 |
| VIT-AC-032 | in-progress | VF-029 closed; untriaged, private, scoped, never auto-promoted; forged principals refused | No machine endpoint or real producer (P1); CI leg |
| VIT-AC-033 | in-progress | Two failed iterations then an independent pass; stale/old/missing refused | Ordo authority; CI leg (VF-034 affects only the legacy path) |
| VIT-AC-034 | in-progress | Reopen-and-resume all-or-nothing, history byte-identical, one conditional write | Ordo authority; real DynamoDB |
| VIT-AC-035 | executed-failed | VF-030/031/033 closed | **VF-036** (principal-less outbox entry accepts a foreign ack); no producer or endpoint (P1) |
| VIT-AC-036 | executed-failed | VF-025..028, VF-032 closed on strict paths | **VF-034** (legacy entry point allows self-pass and non-human pass), **VF-035** (triage-cli treats any IAM workload as human) |

### Per-requirement status (new P0 requirements and mission §7 gates)

| Requirement / gate | Status | Evidence | Open |
|---|---|---|---|
| VIT-LCY-010 | in-progress | Failed result returns to work with verifier, attempt, candidate and evidence; V01/V03/V04/V11 killed | Ordo authority; CI leg |
| VIT-LCY-011 | in-progress | Reopen-and-resume both events, all-or-nothing; V09/CL01 killed | Ordo authority; real DynamoDB |
| VIT-VER-009 | executed-failed | Strict path: independence canonical (R303), author bound (R301/R302), human verifier (R306) | VF-034 (legacy entry point), VF-035 (CLI boundary) |
| VIT-INT-013 | in-progress | VF-029..031 closed; closed envelope own-key checks (R308); public route refuses machine envelopes | No endpoint (proposed); CI leg |
| §7 gate 1 (producer contract and identity model; untrusted claims denied) | in-progress | Independent review done twice; forged principals and source claims refused; echo marker bound to principal | No real producer; CI leg |
| §7 gate 2 (≥ 2 failed iterations, then a later recurrence) | in-progress | Passing locally and on dynalite | CI leg; Ordo |
| §7 gate 3 (evidence and candidate history never disappear) | in-progress | Byte-identical history checks | CI leg |
| §7 gate 4 (bounded autonomous repair with escalation) | executed-failed | Lifecycle API fail-closed budget (R304/R305/R307 killed) | **VF-035**: the triage-cli boundary grants human provenance to any IAM workload |
| §7 gate 5 (no deployment claims without evidence) | in-progress | Machine contract "proposed, no route"; `ordoAuthorized:false` | Re-check at release |


## Final status, fix round 3 (`p0/fix3-verify` from `p0/integration` @ `a574d44`)

This section supersedes the round-2 table below it.

**Local environment:** sandbox, Node v22.22.0. Browser: Chromium 153.0.8010.0 via `@sparticuz/chromium@153.0.0` and `@playwright/test@1.63.0`, at viewports 320 / 375 / 1280. Forma CDN blocked; the "file" mode serves the npm 0.3.0 tarball's `dist/all.css` at the pinned URL. `test:integration` runs on the dynalite emulator; TransactWriteItems uses the owner's labelled shim because dynalite lacks it.

**CI evidence, re-verified independently via `gh api repos/kemiller2002/vitium/actions/runs/<id>`:**
- run **37813042099** "Conditor governance verification": completed / success, head `a8532cb`, branch `p0/governance-conditor-install`.
- run **37813042172** "Praxis validation": completed / success, head `a8532cb`.

`a8532cb` is an ancestor of `a574d44`. **No CI run has been witnessed for `a574d44` itself** (`test.yml`, `p0-service.yml`, `browser.yml`); those legs are pending.

### Commands and outputs (this branch = `a574d44` + test/doc changes only)

| Command | Output |
|---|---|
| `npm test` | 287 tests, 287 pass, 0 fail, 0 todo |
| `npm run test:adversarial` | 130 tests, 119 pass, 0 fail, 11 todo: VF-018, VF-025..VF-033 (VF-029 has 2 tests) |
| `npm run test:integration` | 30 tests, 30 pass |
| `node scripts/secret-scan.mjs` | `[git]` 322 text files, 0 blocked |
| `VITIUM_LOCAL_CHROMIUM=sparticuz npm run test:browser` (CDN blocked) | 66 passed, 0 failed, 0 flaky; axe 0 violations; no overflow |
| same + `VITIUM_FORMA_CSS_FILE=…/dist/all.css` | 66 passed, 0 failed; axe 0 violations |
| mutation appraisal, 88 mutants, `--suites=unit,adversarial,integration` (+ follow-up on M46/M57/V10) | 82 killed; 6 survivors (5 equivalent + M57, see EVIDENCE-APPRAISAL) |

### Per-scenario status (VIT-AC-001..015, 032..036)

No scenario is `verified-passed`. Each needs at least one of: live infrastructure, an operator decision, qualified Ordo/Fides authority, a CI run of this HEAD, or the closure of an open finding.

| Scenario | Status | Local evidence on `a574d44` | What blocks a higher status |
|---|---|---|---|
| VIT-AC-001 | **blocked** | Browser suite in both CSS modes passes: no overflow, keyboard completion, error-summary focus with links and `aria-describedby`, no silent truncation, axe 0 violations | Canonical site not live (AC-014); manual screen-reader session not run; CI `browser.yml` for this HEAD pending; axe colour-contrast needs manual review on decorative glyphs |
| VIT-AC-002 | **in-progress** | Keyboard Review / Edit / Continue; GitHub URL safe, every github.com request aborted; credential text blocked before the link | CI browser leg pending; canonical site not live |
| VIT-AC-003 | **blocked** | Browser wire body accepted by service and schema; receipt only after a durable write; gate off and no intake request | No AWS staging, Turnstile key, intake domain or operator approval |
| VIT-AC-004 | **in-progress** | All boundary, unicode, hostile-input and schema/runtime adversarial tests pass; VF-011 closed by 041318d | CI leg for this HEAD pending (no open finding left in this scenario) |
| VIT-AC-005 | **blocked** | Challenge before any write; malformed-token pre-filter (VF-024, 159cec5); replay never creates a record without a challenge | Per-source throttling not implemented; load test needs AWS staging (VF-024 residual recorded in SEC-001) |
| VIT-AC-006 | **blocked** | Idempotent replay, conflict, NFC replay, lost-response retry all pass locally and on dynalite | Real DynamoDB untested |
| VIT-AC-007 | **blocked** | Store failures never produce a receipt; lossy retry passes on dynalite | AWS staging; GitHub sync is P1 |
| VIT-AC-008 | **blocked** | Redaction and quarantine, site parity, never stored or echoed | No designated operator or escalation owner (VIT-OQ-008) |
| VIT-AC-009 | **in-progress** | Unchallenged conflict is byte-identical to an unused key (VF-023 closed by 159cec5); no read route; receipt is not a capability; replay projection limited by IAM | Mutant M57 survives (a verified conflict that falls through to `putOnce` is not distinguished by any test; behaviour is equivalent today); CI leg pending |
| VIT-AC-010 | **in-progress** | Product/impact parity; registry and migration tests pass | Domain registry tests not independently adjudicated; CI leg pending |
| VIT-AC-011 | **in-progress** | No observation → defect edge; transactional promote (CL02/CL03 killed by integration) | Ordo/Fides authority pending; dynalite shim for TransactWriteItems (real DynamoDB untested) |
| VIT-AC-012 | **in-progress** | Table-driven lifecycle adversarial suite passes | Candidate (non-Ordo) authority; CI leg pending |
| VIT-AC-013 | **in-progress** | Not re-run locally by verification | **CI leg witnessed**: runs 37813042099 and 37813042172, success on `a8532cb` (attestation-verified install per the integrator; the run conclusions themselves were re-checked via the REST API). Verification of the qualified Ordo transition authority itself is not claimed (BSR item 9). |
| VIT-AC-014 | **blocked** | n/a | Operator Pages/DNS/TLS |
| VIT-AC-015 | **blocked** | Git-aware secret scan 0 (VF-022 closed by e172749); no secrets in assets or responses; allow-listed logs | Deployed-Lambda log canary; VF-018 (SRI) open |
| VIT-AC-032 | **executed-failed** | Machine core: authenticated, scoped, untriaged, private, never auto-promoted; forged principals refused (copy, clone, Proxy, `Object.create`) | **VF-029**: inherited-name keys (`constructor`, `toString`, `__proto__`, …) bypass the closed-envelope check and are stored unredacted (schema/runtime disagree). No machine endpoint or real producer (P1). |
| VIT-AC-033 | **in-progress** | Two failed iterations, then an independent pass; every attempt, candidate and run kept; stale/old-candidate/missing-evidence/inconclusive results refused; dynalite I-20 | Open findings affect the "independent pass" guarantee (VF-025, VF-026, VF-028, listed under AC-036); Ordo authority pending |
| VIT-AC-034 | **in-progress** | reopen-and-resume keeps earlier passing evidence byte-identical; all-or-nothing (V09 killed); one conditional write (CL01, I-21) | Ordo authority pending; real DynamoDB untested |
| VIT-AC-035 | **executed-failed** | Idempotent delivery; conflict; occurrences kept per fingerprint; causation ordering; build result untouched; bounded outbox | **VF-030** (body-claimed Vitium origin silently drops a legitimate event), **VF-031** (another principal gets a replay ack for someone else's eventId), **VF-033** (outbox marks any 2xx as delivered). No real producer or endpoint (P1). |
| VIT-AC-036 | **executed-failed** | Inconclusive is neither pass nor fail; budget per defect cycle (alternating agent names do not bypass it); only a human escalation resets the budget; machine self-certification withheld | **VF-025** (submitter names someone else as author, then passes own work), **VF-026** (case-variant actor defeats independence), **VF-027** (legacy shape and self-declared provenance bypass the agent budget), **VF-028** (agent-provenance verifier can resolve), **VF-032** (machine path refuses a re-run after inconclusive) |

### Per-requirement table (new P0 requirements and mission §7 gates)

| Requirement / gate | Status | Evidence | Open |
|---|---|---|---|
| VIT-LCY-010 (failed verification → in-progress with failed result, verifier, attempt, evidence, candidate, reason) | in-progress | `verification-cycle.test.mjs` (stale/old-candidate/missing-evidence refused; outcome recorded); V01, V03, V04, V11 killed | Ordo authority; CI leg |
| VIT-LCY-011 (resolved/closed → reopened → resume, both events preserved) | in-progress | AC-034 test; V09, CL01 killed; dynalite I-21 single conditional write | Ordo authority; real DynamoDB |
| VIT-VER-009 (failure never resolves; passing needs independent proof) | executed-failed | Failure path holds | VF-025, VF-026, VF-028 (independence can be bypassed) |
| VIT-INT-013 (versioned authenticated machine contract, separate from public intake) | executed-failed | Separate contract, principal brand, scope checks; public route refuses machine envelopes | VF-029 (closed-envelope bypass); no endpoint (proposed only) |
| §7 gate 1: producer contract and identity model reviewed; adapter denies untrusted provider claims | executed-failed | Independent review done (this pass); forged principals and source claims refused | VF-029, VF-030, VF-031 |
| §7 gate 2: ≥ 2 failed iterations before a pass, then a later recurrence | in-progress | AC-033 + AC-034 tests pass locally and on dynalite | CI leg; Ordo authority |
| §7 gate 3: evidence and candidate commits never disappear | in-progress | Byte-identical history checks across fail/pass/reopen | CI leg |
| §7 gate 4: autonomous repair stops at a bounded threshold and escalates | executed-failed | Strict agent path stops at 3 (provisional) and needs a human escalation | VF-027 (legacy shape / self-declared provenance bypass) |
| §7 gate 5: no claim that producers, machine API or Ordo authority are deployed | in-progress | Docs reviewed: machine contract marked "proposed, no route"; table `ordoAuthorized:false` | Re-check at release |


## Final status, fix round 2 (`p0/fix2-verify` from `p0/integration` @ `25ce853`)

**Environment for every local result in this table:** local sandbox, Node v22.22.0. Browser: Chromium 153.0.8010.0 via `@sparticuz/chromium@153.0.0` and `@playwright/test@1.63.0`, at viewports 320 / 375 / 1280. Forma CDN blocked; the "file" mode serves the npm tarball's `dist/all.css` at the pinned URL. `test:integration` runs on the dynalite emulator.

**CI legs** (`test.yml`, `p0-service.yml`, `browser.yml` cdn and blocked) are **pending** until the integrator reports CI run IDs. A local pass is local evidence only.

No scenario is `verified-passed`. Every P0 scenario either depends on live infrastructure or operator decisions that do not exist, or still has an open finding or pending CI confirmation.

### Commands and outputs on `25ce853` + this branch's test/doc changes

| Command | Output |
|---|---|
| `npm test` | 207 tests, 207 pass, 0 fail, 0 todo |
| `npm run test:adversarial` | 105 tests, 102 pass, 0 fail, 3 todo (VF-011, VF-018, VF-023) |
| `npm run test:integration` | 20 tests, 20 pass (dynalite) |
| `node scripts/secret-scan.mjs` | 293 text files, 0 blocked |
| `VITIUM_LOCAL_CHROMIUM=sparticuz npm run test:browser` (CDN blocked) | 66 passed, 0 failed, 0 flaky; axe 0 violations |
| same + `VITIUM_FORMA_CSS_FILE=…/dist/all.css` | 66 passed, 0 failed; axe 0 violations |
| `node tests/verification/mutation-appraisal.mjs --suites=unit,adversarial` (55 mutants) + integration and browser follow-ups | 51 / 55 killed; 4 equivalent survivors (M23, M38, M43, M48) |

### Per-scenario status

| Scenario | Status | Evidence (local, `25ce853`) | What prevents a higher status |
|---|---|---|---|
| VIT-AC-001 | **blocked** | Browser suite, both CSS modes: no overflow at 320/375/1280; keyboard-only completion; error summary focused, with links and `aria-describedby` (VF-001/002 closed); no silent truncation (VF-003 closed); axe 0 violations | The scenario requires the **canonical site** (VIT-AC-014, operator Pages/DNS/TLS); a manual screen-reader session (not executed); CI browser run ID pending; axe `color-contrast` incomplete on decorative glyphs (manual review) |
| VIT-AC-002 | **in-progress** | Browser keyboard flow: Review → Edit preserves every field → Review; Continue href is `github.com/kemiller2002/vitium/issues/new` with only title/body, sanitised URL, no secrets; every github.com request aborted; no "submitted" state; credential text blocked before the link (VF-004 closed) | CI `browser.yml` cdn leg pending; canonical site not live |
| VIT-AC-003 | **blocked** | Adversarial: the browser's wire body is accepted by service and schema (VF-005 closed); receipt only after a durable write; gate `enabled:false` never contacts intake/Turnstile hosts (browser) | No AWS staging, Turnstile key, HTTPS intake domain or operator approval (VIT-OQ-003/004/008); feature gate stays off by policy |
| VIT-AC-004 | **executed-failed** | Boundaries, unexpected/prototype fields, unicode/bidi/NFC, hostile markup, URL schemes and schema/runtime agreement all pass | **VF-011 open**: the service accepts `https://example.com/` + 990×`é` and stores a 5,960-character `pageUrl` (limit 2,000 measured before sanitising). Owner domain |
| VIT-AC-005 | **blocked** | Challenge before any write; non-boolean verifier refused; replay never creates a record without a challenge (`replay-path.test.mjs`) | Per-source throttling not implemented (SEC-001); load test needs AWS staging. VF-024 (unchallenged store read per request) recorded |
| VIT-AC-006 | **blocked** | Same key + same body → one record, same reference, 200 `replayed:true` without a new challenge (VF-010 closed); different body → 409 with no content; NFC-equivalent replay is one report; dynalite concurrency I-tests pass | Real DynamoDB conditional-write behaviour is untested (emulator only); needs AWS staging |
| VIT-AC-007 | **blocked** | Store throw / malformed / inconsistent reply → 503, never a receipt (VF-013 closed); lossy-response retry passes on dynalite | Real store-failure and GitHub-sync behaviour need AWS staging; the GitHub sync worker is not implemented (P1) |
| VIT-AC-008 | **blocked** | Redaction + quarantine for PEM, URL creds, secret params, `;jsessionid=`, Bearer, JWT, GitHub, AWS, Slack, API keys, cards; never stored or echoed (VF-009 closed); site blocks the same samples (VF-004 closed) | No designated operator or escalation owner (VIT-OQ-008); private escalation path not operational |
| VIT-AC-009 | **executed-failed** | No read/status route; replay/conflict bodies contain no stored content; receipt is not a capability; IAM projection limits GetItem | **VF-023 open**: without a challenge, unknown key → 403, used key + other body → 409, so a leaked idempotency key's use is detectable. Owner intake |
| VIT-AC-010 | **in-progress** | Product/impact lists identical across site JS, site HTML, service and schema; no silent alias mapping; unsupported schemaVersion refused; registry/migration tests in `npm test` pass | VF-011 (stored value exceeds the documented field limit); domain registry and migration tests (`tests/domain-*.test.mjs`) were not independently adjudicated in this pass |
| VIT-AC-011 | **in-progress** | No observation → defect edge from any state; promotion only from `classified` by authorised roles; triage fields independent | Ordo authority not installed (table is `ordoAuthorized:false` by design); Fides operator authorization pending; CLI treats any permitted IAM principal as triager (documented provisional) |
| VIT-AC-012 | **in-progress** | Lifecycle adversarial suite (table-driven): every edge executable with its obligations; every obligation enforced; every absent pair refused; closure reasons and evidence required; reopen needs new evidence and preserves byte-identical history; truncated/aliased history refused (VF-014..017 closed) | All executable checks pass **locally**; CI run ID pending. Candidate (non-Ordo) authority per DOM-001 |
| VIT-AC-013 | **in-progress** | Not re-witnessed by verification in this pass | The coordinator reports `conditor verify/doctor`, `praxis verify --strict`, `ordo verify`, `./praxis validate` exit 0; independent re-run and CI run IDs pending |
| VIT-AC-014 | **blocked** | n/a | Operator must enable Pages for Actions and configure the DNS/TLS custom domain; browser suite then re-run against `https://vitium.echelonfoundry.com/` |
| VIT-AC-015 | **blocked** | Secret scan 0 findings; static assets contain no credential patterns or AWS endpoints; responses never echo token, infra errors or report text; log records allow-listed (`safe-log.mjs`) | CloudWatch log-redaction negative canary needs a deployed Lambda; VF-018 (no SRI on the CDN stylesheet) and VF-022 (scanner scope) open |

### Open findings with owner

| ID | Sev | Owner | Reproduction |
|---|---|---|---|
| VF-011 | medium | domain (`service/report-domain.mjs`) | `node --test --test-name-pattern="accepted by the site" tests/adversarial/contract-divergence.test.mjs` |
| VF-018 | medium | ux / ops | `node --test --test-name-pattern="SRI" tests/adversarial/contract-divergence.test.mjs`; blocked on the jsDelivr byte check (UX-0001 UX-G1) |
| VF-022 | low | ops (`scripts/lib/secret-scan.mjs`) | Put a runtime-assembled canary in `tests/browser/.output/x.md`, then run `node scripts/secret-scan.mjs` → 1 blocked |
| VF-023 | medium | intake (`service/intake.mjs` replay path) | `node --test --test-name-pattern="unchallenged caller" tests/adversarial/replay-path.test.mjs` |
| VF-024 | low | intake / ops | Probe: 20 unchallenged fresh-key requests → 20 store reads, 0 verifier calls (EVIDENCE-APPRAISAL § Fix round 2) |


> **Fix round 1 update (`p0/fix1-verify` on `p0/integration` @ `2b9de54`).** The tables below record the phase-1 baseline runs.
> Integrated-tree results:
> - `npm run test:adversarial`: 101 tests, 72 pass, 0 fail, 29 todo.
> - `npm test` (not owned here): 172 tests, 164 pass, 7 fail, 1 todo. The failures are in other owners' files.
> - Browser, block and file CSS modes: 66 expected / 0 unexpected each. 63 pass; the 3 VF-004 `test.fail` cases fail as expected.
> - axe: 0 violations.
>
> Closed by integration: VF-001, VF-002, VF-003, VF-013, VF-014, VF-015 (duplicate reference, evidenceId).
> New: VF-020, VF-021, VF-022.
> Mutation appraisal: 44 mutants, 41 killed by unit + adversarial. M24 was killed after a new test. M38 and M43 are equivalent mutants.
> Adjudication and evidence: `EVIDENCE-APPRAISAL.md` § "Fix round 1". No scenario is promoted to `verified-passed`.

## Execution environment of the recorded runs (2026-10-08)

| Item | Value |
|---|---|
| Source | baseline `bba1d59` plus test-only files on this branch (no site/service/schema change) |
| Node | v22.22.0 |
| Browser | Chromium **153.0.8010.0** from npm `@sparticuz/chromium@153.0.0` (installed `--no-save`, not in lockfile), driven by `@playwright/test@1.63.0`. Vendor flags that disable web security are filtered out (`tests/verification/chromium-launch.mjs`). |
| Playwright CDN | `npx playwright install chromium` **failed**: `ERR_SOCKET_CLOSED` on all three azureedge mirrors, then `Failed to download Chromium 130.0.6723.31`. |
| Forma CSS | `cdn.jsdelivr.net` blocked by the proxy (`CONNECT tunnel failed, response 403`). Two local modes were run: **block** (all external requests aborted) and **file** (the exact pinned URL served from the npm tarball `@echelon-foundry/design-system@0.3.0`, `dist/all.css` sha256 `0a207c4d…1895`). CI runs a **cdn** leg against the live CDN; that leg has **not** been observed yet. |
| Commands | `npm test`; `npm run test:adversarial`; `VITIUM_LOCAL_CHROMIUM=sparticuz npm run test:browser`; the same with `VITIUM_FORMA_CSS_FILE=<tarball>/dist/all.css`; `node tests/verification/mutation-appraisal.mjs --scratch=<dir> --suites=…` |

Recorded results:

- `npm test`: **38 tests, 38 pass, 0 fail**.
- `npm run test:adversarial`: **95 tests, 64 pass, 0 fail, 31 todo**. All 31 todo tests fail against baseline; each one is a finding (VF-004…VF-018).
- `npm run test:browser`, block mode: **66 expected** (54 pass, plus 12 `test.fail` findings that failed as expected), 0 unexpected, 0 flaky, 1.8 min.
- `npm run test:browser`, file mode (real Forma 0.3.0 CSS): **66 expected**, 0 unexpected.
- axe-core 4.13.0 (wcag2a/2aa/21a/21aa/22aa plus best-practice, no rules disabled): **0 violations** in initial and review states at 320, 375 and 1280, in both CSS modes. `incomplete`: `color-contrast` on 1 to 2 decorative `aria-hidden` glyphs (`.privacy-note > span`, submit button arrow), which needs manual review.

## Scenario matrix

Legend for "where": `U` = existing unit test (`tests/*.test.mjs`), `A` = adversarial (`tests/adversarial/*.test.mjs`, built here), `B` = browser (`tests/browser/reporter.spec.mjs`, built here, runs once per viewport w320/w375/w1280), `M` = mutation appraisal.

### VIT-AC-001: responsive, keyboard and screen-reader submission (UX-001/002/006/007)

| Check that would prove it | Where | Result |
|---|---|---|
| Native labels on every control | U `governance.test.mjs` "reporting remains accessible…" (static regex); B "page degrades acceptably…" (`labels.length>0`) | executed-pass |
| No horizontal scroll at 320/375/1280 in initial, native-invalid, error and review states | B "no horizontal scroll in initial, review and error states" | executed-pass (scrollWidth == clientWidth in every state, both CSS modes) |
| Long unbroken text does not overflow the review | B "long unbroken text at field limits…" | executed-pass |
| Keyboard-only completion, focus order, Review/Edit/Review | B "Tab/typing completes the form…" | executed-pass |
| Actionable error focus: error summary with linked, `aria-describedby` field errors | B "empty submit focuses an error summary…" | **executed-fail, VF-001** |
| Hints programmatically associated | B "hint text is programmatically associated…" | **executed-fail, VF-002** |
| axe WCAG A/AA with zero violations | B "axe WCAG 2.x A/AA + best-practice: initial/review" | executed-pass (0 violations; contrast incomplete on decorative glyphs) |
| Screen-reader (NVDA/VoiceOver) walkthrough | none | not-executed: needs a manual AT session |
| On the **canonical site** | none | blocked: VIT-AC-014 (Pages/DNS/TLS not live) |
| **Scenario status** | | **executed-failed** (VF-001, VF-002) |

### VIT-AC-002: legacy GitHub handoff: Review, Edit, Continue (UX-003/004, INT-001)

| Check | Where | Result |
|---|---|---|
| Preview shows contents; Edit preserves every field | B keyboard flow (`formValues` deep-equal after Edit) | executed-pass; M20 (Edit calls `form.reset()`) killed by B only |
| Continue href is `https://github.com/kemiller2002/vitium/issues/new` with only `title` and `body`, percent-encoded, sanitised URL, no secrets | U `submission.test.mjs` "issue link points…"; B keyboard flow | executed-pass |
| Activating Continue makes no real request (every github.com request aborted) | B keyboard flow (network guard log) | executed-pass |
| No "submitted/received" state on the legacy path | B keyboard flow | executed-pass |
| **Scenario status** | | **in-progress**: browser checks pass locally; the CI cdn leg has not been observed and the canonical URL is not live |

### VIT-AC-003: anonymous direct API, durable receipt (UX-004/005, API-001/005)

| Check | Where | Result |
|---|---|---|
| Receipt only after store success; private observation | U `intake.test.mjs` "accepted private intake is durable…"; A "observation … validates against observation.schema.json" | executed-pass (in-memory store) |
| The browser's own wire body is accepted by the service and the schema | A "the request the browser would send is accepted…" / "…validates against intake-request.schema.json" | **executed-fail, VF-005** |
| Gate: private intake unreachable while `enabled:false` (no request to intake/challenge hosts, forced click refused) | B "enabled:false never contacts intake…"; U `p0-contract.test.mjs` | executed-pass; M18 (gate fails open) killed by B only |
| Real DynamoDB / Turnstile / HTTPS endpoint | none | blocked: no AWS staging, no Turnstile key, no operator approval (VIT-OQ-003/004/008) |
| **Scenario status** | | **blocked** (infrastructure), and **executed-failed** on the client/server contract (VF-005) |

### VIT-AC-004: missing, oversized, malformed, hostile, mixed-schema payloads (API-002, UX-007)

| Check | Where | Result |
|---|---|---|
| limit-1/limit/limit+1 for title/actual/expected/steps/pageUrl | A "boundary …" (5 tests); U "input size limits…" | executed-pass |
| 16 KiB body limit counts bytes; base64 decoded first | A "HTTP body size boundary…", "base64 body…" | executed-pass; M15 killed by A only |
| Unexpected / `__proto__` / `constructor` properties refused, nothing stored | A "unexpected and prototype-polluting…" | executed-pass; M14 killed by A only |
| Schema and runtime agree | A `schema-runtime.test.mjs` (17 agreement cases pass, 11 divergent) | **executed-fail, VF-006, VF-007** |
| Invisible / bidi / C1 / lone-surrogate summaries | A "visually empty or bidi-spoofing…" | **executed-fail, VF-008** |
| Hostile markup rendered as text; no dialog, no `src=x` fetch, no injected nodes | B "markup is rendered as text…" | executed-pass; M17 (`innerHTML`) killed by B only |
| `javascript:`/`data:`/`vbscript:`/`file:` page URLs refused | U; B "page URL scheme is refused" (6 per viewport) | executed-pass |
| Typed content preserved after a recoverable error | B "client-side error is announced…", "encoded GitHub link overflow…" | executed-pass |
| 10k paste is not silently truncated | B "pasting 10,000 characters…" | **executed-fail, VF-003** |
| **Scenario status** | | **executed-failed** |

### VIT-AC-005: burst traffic and per-source limits (API-003/005)

| Check | Where | Result |
|---|---|---|
| Challenge verified before any store effect | A "challenge is verified before any store effect"; U "challenge failure blocks storage" | executed-pass; M05 killed by U and A |
| Non-boolean truthy verifier result refused | A | executed-pass; M06 killed by A only |
| Per-source rate limit and queue bound | none | blocked: only global API Gateway throttle in SAM (2 rps / burst 4); no per-source control exists; needs AWS staging plus a load test |
| **Scenario status** | | **blocked** |

### VIT-AC-006: idempotent replay (API-004, DOM-002)

| Check | Where | Result |
|---|---|---|
| Same key and body give one record and the same reference | U "same request is idempotent…", "parallel deliveries…" | executed-pass (in-memory) |
| Altered body under the same key gives 409 without leaking the reference | U; A "replay with altered body…" (4 variants) | executed-pass; M04 killed |
| Spent challenge token for a new report refused | A "reusing a spent challenge token…" | executed-pass (single-use verifier model) |
| Identical retry after a lost response (same token) reaches the stored receipt | A "an identical retry after a lost response…" | **executed-fail, VF-010** |
| Retry with a fresh token (the path `app.mjs` takes) | A control test | executed-pass |
| NFC/NFD replay is the same report | A | **executed-fail, VF-008** |
| Real conditional DynamoDB concurrency | none | blocked: AWS staging |
| **Scenario status** | | **executed-failed** (VF-010), and blocked for the real adapter |

### VIT-AC-007: store failure, downstream unavailable, retry (API-005, NFR-006)

| Check | Where | Result |
|---|---|---|
| Store throws, giving 503 with no receipt and no leak | U; A "challenge token, secret-bearing errors…" | executed-pass; M08 killed by U only |
| Malformed store reply never acknowledged | A "a store that resolves 'created' but…" | executed-pass; M07 killed by A only |
| Inconsistent reply classified as a retryable 503, not a client 409 | A | **executed-fail, VF-013** |
| GitHub sync failure after acknowledgment | none | not-started: no sync worker exists (P1 path) |
| **Scenario status** | | **executed-failed** (VF-013), partly not-started |

### VIT-AC-008: token, private data or vulnerability in a report (API-006/007, NFR-004/005/011)

| Check | Where | Result |
|---|---|---|
| Service refuses ghp_/sk-/password=/PEM in every text field; error does not echo the secret | U; A control test | executed-pass; M19 killed |
| Broader credential formats (fine-grained PAT, AKIA, xoxb, JWT, Bearer, token=, token in URL path, `;jsessionid=`) | A | **executed-fail, VF-009** |
| Legacy client refuses or redacts credentials before building the public URL | A "site and service agree…"; B "credential-looking text…" | **executed-fail, VF-004** |
| Quarantine / private escalation / designated operator | none | blocked: VIT-OQ-008 (no operator), no quarantine implementation |
| **Scenario status** | | **executed-failed** |

### VIT-AC-009: guessing receipts, enumeration, cross-product lookup (API-010, OPS-002)

| Check | Where | Result |
|---|---|---|
| No read/GET routes; path/method variants are 404 and store untouched | A "path and method variants…"; U | executed-pass |
| Conflict response does not disclose the original reference | A | executed-pass |
| Exact origin match | A "origin comparison is exact…" | executed-pass; M13 killed by A only |
| Status capability | none | not-started (no status endpoint, P1 per VIT-OQ-005) |
| **Scenario status** | | **in-progress** (absence of a read surface verified at unit level only) |

### VIT-AC-010: product identity, aliases, source, schema version (DOM-001/003/004/005/006)

| Check | Where | Result |
|---|---|---|
| Product and impact lists identical in site JS, site HTML `<select>`, service, request schema | A "product list identical…", "impact list identical…"; U (JS-only comparison) | executed-pass; M12 (HTML-only mismatch) killed by A only |
| No silent case/homoglyph mapping | A | executed-pass |
| Unsupported schemaVersion refused | U; A | executed-pass |
| Defect schema can represent triage states; impact vocabulary mapped | A | **executed-fail, VF-012** |
| Versioned registry, aliases, provenance classes | none | not-started (domain agent) |
| **Scenario status** | | **executed-failed** |

### VIT-AC-011: observation only; independent triage (LCY-001/002/003)

| Check | Where | Result |
|---|---|---|
| No observation-to-defect crossing from any state, even as administrator | A; U | executed-pass |
| Unauthorised roles and blank actors refused | A; U | executed-pass |
| Severity/priority/owner recorded independently | none | not-started (no fields in the transition command) |
| **Scenario status** | | **in-progress** |

### VIT-AC-012: illegal transition, close reason, duplicate, reopen (LCY-001/004)

| Check | Where | Result |
|---|---|---|
| Documented edges executable | A | executed-pass |
| Skips and terminal escapes refused | A "same-kind skips and terminal escapes…" | executed-pass; M09 killed by A only (U missed it) |
| Undocumented edges refused | A | **executed-fail, VF-014** |
| Close reason required | A; U | executed-pass; M16 killed |
| Duplicate needs canonical reference; close needs evidence; evidenceId must be a string | A | **executed-fail, VF-015** |
| Reopen preserves closure evidence and history (frozen) | A; U | executed-pass |
| History cannot be truncated or aliased by the caller | A | **executed-fail, VF-016** |
| Timestamp validity | A | **executed-fail, VF-017** |
| **Scenario status** | | **executed-failed** |

### VIT-AC-013: genuine Conditor install, Praxis/Ordo verification (NFR-001/002/008)

| Check | Where | Result |
|---|---|---|
| Manifest pins declared versions | U `governance.test.mjs` | executed-pass (declaration only) |
| Real lock/receipts present and CI rejects drift | none | blocked: governance agent; nothing installed on baseline |
| Third-party asset integrity (SRI) | A | **executed-fail, VF-018** |
| **Scenario status** | | **blocked** |

### VIT-AC-014: production Pages, custom domain, DNS/TLS (NFR-003, UX-001)

| Check | Where | Result |
|---|---|---|
| Canonical metadata | U | executed-pass (static) |
| HTTPS canonical URL serves site and all resources | none | blocked: Pages not enabled (run 37758370436 failed at `configure-pages`), DNS/TLS unverified; operator action |
| Browser suite against the deployed origin | B can run with a different `baseURL` | not-executed |
| **Scenario status** | | **blocked** |

### VIT-AC-015: no secrets or PII in published assets and logs (API-001/007, NFR-004)

| Check | Where | Result |
|---|---|---|
| Static assets contain no credential patterns or AWS endpoints | A "static site assets contain no credential material…" | executed-pass |
| Responses never echo challenge token, infrastructure error text, account IDs or report text | A | executed-pass |
| Disabled intake never contacts intake/challenge hosts | B | executed-pass |
| Legacy URL carries credentials when typed (public URL, browser history) | A; B | **executed-fail, VF-004** |
| CloudWatch log redaction negative canary | none | blocked: no deployed Lambda |
| **Scenario status** | | **executed-failed** (VF-004), blocked for logs |

## Mutation-sensitivity appraisal (VIT-VER-003)

Each mutant was applied to a scratch copy (`tests/verification/mutation-appraisal.mjs`; the working tree was never modified). "Killed" means at least one test failed.

| Mutant | Guard broken | Baseline `npm test` | + adversarial | + browser (w375) |
|---|---|---|---|---|
| M01 | legacy URL keeps query/fragment | killed (2) | not killed | killed |
| M02 | legacy URL scheme allowlist removed | killed (1) | not killed | killed (8) |
| M03 | service URL keeps query/fragment | killed | killed | n/a |
| M04 | idempotency hash conflict removed | killed | killed | n/a |
| M05 | store before challenge | killed (3) | killed (5) | n/a |
| M06 | truthy challenge result accepted | **SURVIVED** | killed | n/a |
| M07 | receipt despite malformed store reply | **SURVIVED** | killed | n/a |
| M08 | store failure swallowed as created | killed | not killed | n/a |
| M09 | illegal-transition refusal removed | **SURVIVED** | killed | n/a |
| M10 | resolve without verifier role | killed | not killed | n/a |
| M11 | service gains unknown product | killed | killed | n/a |
| M12 | product only added to HTML `<select>` | **SURVIVED** | killed | **not killed** |
| M13 | origin suffix match | **SURVIVED** | killed | n/a |
| M14 | unexpected-field refusal removed | **SURVIVED** | killed | n/a |
| M15 | body limit counts chars, not bytes | **SURVIVED** | killed | n/a |
| M16 | transition reason not required | killed | killed | n/a |
| M17 | preview uses `innerHTML` | **SURVIVED** | not killed | killed |
| M18 | private gate fails open | **SURVIVED** | not killed | killed (6) |
| M19 | credential guard removed | killed | killed | n/a |
| M20 | Edit resets the form | **SURVIVED** | not killed | killed |

The baseline unit suite missed **10 of 20** important guards (finding VF-019). With the adversarial suite all 20 are killed by at least one suite. M17, M18 and M20 are killed only by the browser suite, which does not run in `npm test`.

## Findings index

Full reproductions are in the verification report; the summary is in `docs/verification/EVIDENCE-APPRAISAL.md`.

| ID | Sev | Req / AC | Owner | Summary |
|---|---|---|---|---|
| VF-001 | high | UX-007, AC-001 | ux | No focusable error summary; native bubbles only; no `aria-invalid`/`aria-describedby` errors |
| VF-002 | low | UX-006 | ux | `.hint` text not linked by `aria-describedby` |
| VF-003 | medium | UX-007, AC-004 | ux | `maxlength` silently truncates pasted text (10k becomes 1200) |
| VF-004 | high | AC-008, AC-015, NFR-004 | ux + intake | Legacy path puts credential-looking text into a public GitHub URL; the service refuses the same text |
| VF-005 | **critical** | AC-003, API-001, DOM-003 | ux + intake | Browser wire body omits `schemaVersion` (service 400 "Unsupported report version") and sends `pageUrl:""` (schema `format: uri` fails): enabled private intake could never accept a report |
| VF-006 | medium | DOM-003 | domain | Schema `maxLength` counts code points, runtime counts UTF-16 units: astral text accepted by schema, refused by runtime |
| VF-007 | medium | DOM-003, AC-004 | domain | 9 more schema/runtime divergences (whitespace, NUL, `javascript:`/`data:` URL, credentials accepted by schema; `""`/`null`/padded values accepted by runtime) |
| VF-008 | medium | API-002, AC-004/006 | intake | Zero-width/bidi/C1/lone-surrogate summaries accepted verbatim; NFC vs NFD replay gives a 409 |
| VF-009 | high | AC-008, NFR-004 | intake | Credential guard misses fine-grained PAT, AKIA, xoxb, JWT, Bearer, token=, token in URL path, `;jsessionid=` |
| VF-010 | high | API-004, AC-006 | intake | Identical retry after a lost response is refused 403 by a single-use challenge before the idempotency lookup; the stored receipt is unreachable |
| VF-011 | low | API-002, UX-007 | ux + intake | Site checks URL length before sanitisation; percent-encoding can exceed the service 2000 limit |
| VF-012 | medium | DOM-003/006, LCY-004 | domain | `defect.schema.json` lacks `reopened`; impact labels and codes are disjoint with no mapping |
| VF-013 | low | API-005, AC-007 | intake | Store `created:false` with no existing record becomes a client 409 instead of a retryable 503 |
| VF-014 | medium | LCY-001, AC-012 | domain + governance | 15 transitions executable that are not in the documented candidate diagram |
| VF-015 | medium | LCY-004, AC-012 | domain | Duplicate without canonical ref; resolved to closed without evidence; any truthy `evidenceId` |
| VF-016 | medium | LCY-004, DOM-007 | domain | Caller-supplied history may be truncated (revision 2, history []) or aliased (mutable events) |
| VF-017 | low | DOM-007 | domain | `occurredAt` only prefix-regex checked (`2026-99-99T99:99:99` accepted) |
| VF-018 | medium | NFR-008, REP-011 | ux / ops | CDN stylesheet version-pinned but no SRI `integrity`/`crossorigin` |
| VF-019 | medium | VER-003, AC-023 | all (test owners) | Baseline `npm test` lets 10/20 guard mutants survive |
| VF-020 | medium | AC-009, SEC-001 | intake | Receipt exposes `disposition`/`notices`, an oracle for the screening detectors (fix round 1) |
| VF-021 | medium | DOM-003 | domain | `observation.schema.json` refuses the observation shape makeIntake produces (fix round 1) |
| VF-022 | low | NFR-004 | ops | Secret scanner scans gitignored browser output; false positives after a browser run (fix round 1) |
| VF-023 | medium | AC-009, API-010 | intake | Replay path: unchallenged key-existence oracle (403 vs 409) (fix round 2) |
| VF-024 | low | AC-005, API-003 | intake/ops | One strongly consistent store read per unchallenged request (fix round 2) |
| VF-025 | high | VER-006/009, AC-036 | domain | Caller-supplied author lets the submitter pass its own attempt (fix round 3) |
| VF-026 | medium | VER-006, AC-036 | domain | Independence defeated by case-variant actor ids (fix round 3) |
| VF-027 | high | VER-011, §7 gate 4 | domain | Agent repair budget bypassed by legacy shape or self-declared provenance (fix round 3) |
| VF-028 | medium | VER-006, AC-036 | domain/governance | Agent-provenance verifier can record a pass (fix round 3) |
| VF-029 | high | INT-013/016, AC-032 | machine | Inherited-name keys bypass closed envelope; stored unredacted; schema/runtime disagree (fix round 3) |
| VF-030 | medium | INT-015, AC-035 | machine | Body-claimed Vitium origin marker silently drops legitimate events (fix round 3) |
| VF-031 | medium | INT-016, AC-035 | machine | Cross-principal eventId replay gets a replay ack (fix round 3) |
| VF-032 | medium | VER-010, AC-036 | machine | Re-run after inconclusive refused on the machine path (fix round 3) |
| VF-033 | low | AC-035 | machine | Outbox treats any 2xx as delivered (fix round 3) |
| VF-034 | medium | VER-006/009, AC-036 | domain | Legacy entry point allows self-pass and non-human pass (fix round 4) |
| VF-035 | high | VER-011, §7 gate 4 | domain/ops | triage-cli maps every IAM principal (incl. agent workloads) to authenticated-human (fix round 4) |
| VF-036 | low | AC-035 | machine | Principal-less outbox entry accepts a foreign ack (fix round 4) |
