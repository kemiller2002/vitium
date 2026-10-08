# Vitium P0 evidence appraisal and findings (phase 1)

Baseline: `main` @ `bba1d59`. Branch: `p0/verification-harness`. Date: 2026-10-08.
Scope: an independent appraisal. Owners fix, verification re-runs. Nothing in this file is a pass certificate. The matrix is in `P0-THREAT-TEST-MATRIX.md`.

## How to re-run on an integrated branch

```sh
npm ci
npm test                                   # fast unit suite (no browser)
npm run test:adversarial                   # findings are { todo: "finding VF-xxx" }
# CI or a machine with Playwright browsers:
npx playwright install --with-deps chromium && npm run test:browser
# Locally where the Playwright CDN is blocked:
npm i --no-save @sparticuz/chromium@153.0.0
VITIUM_LOCAL_CHROMIUM=sparticuz npm run test:browser
# Optional: real Forma CSS without the CDN (exact pinned URL fulfilled from the npm tarball)
npm pack @echelon-foundry/design-system@0.3.0 && tar xzf echelon-foundry-design-system-0.3.0.tgz
VITIUM_LOCAL_CHROMIUM=sparticuz VITIUM_FORMA_CSS_FILE=$PWD/package/dist/all.css npm run test:browser
# Mutation appraisal (copies the repo to a scratch dir; never touches the tree)
node tests/verification/mutation-appraisal.mjs --scratch=/tmp/vitium-mut --suites=unit,adversarial[,browser]
```

When a finding is fixed, its `todo` (node) or `test.fail` (Playwright) marker starts reporting the test as passing unexpectedly. Remove the marker in the same change. Never relax the assertion.

## Appraisal of existing evidence

| Evidence claimed on baseline | Appraisal |
|---|---|
| "Node contract tests" for the form | Pure-function tests are sound for `submission.mjs`, but the DOM layer (`app.mjs`) had **no** executed coverage: M17 (`innerHTML`), M18 (gate fails open) and M20 (Edit resets) survive `npm test`. |
| `governance.test.mjs` accessibility test | Static regex over HTML. It proves ids and `for=` exist, not focus behaviour, error association or contrast. |
| `p0-contract.test.mjs` "same product and impact names" | Compares JS arrays only. The HTML `<select>` the user actually sees is not compared (M12 survives). |
| `p0-contract.test.mjs` "browser only shows private confirmation…" | Regex over source text, not behaviour. It also never exercised the browser's real request body, which the service refuses (VF-005). |
| `intake.test.mjs` adversarial cases | Good coverage of origin, idempotency, conflict and storage errors. It misses the non-boolean challenge result (M06), malformed store replies (M07), unexpected fields (M14) and byte-vs-char size (M15). Its fixture always supplies `schemaVersion`, which hid VF-005. |
| `triage.test.mjs` | Covers guards on legal paths, but no test asserts that an arbitrary illegal same-kind edge is refused (M09 survives). |
| Schemas | Never executed by any test before this branch. They diverge from the runtime in 11 classes (VF-005/006/007). |
| "SAM build passed" | Template acceptance only (as `P0-IMPLEMENTATION.md` states). It is not runtime evidence. |

## Findings with reproduction

Unless stated otherwise, every reproduction runs from the repository root on this branch. "Owner" is the suggested owner.

**VF-001 (high, VIT-UX-007, VIT-AC-001, owner ux).** `VITIUM_LOCAL_CHROMIUM=sparticuz npx playwright test -c tests/browser/playwright.config.mjs -g "error summary"`. Observed: an empty submit calls `form.reportValidity()`, the native bubble appears and focus goes to `#product`; there is no summary element, no `aria-invalid` and no `aria-describedby`. Expected: a focused error summary with links to each invalid field, plus per-field messages associated through `aria-describedby`. The native bubble is not persistent and is announced inconsistently. The adjacent check "empty submit keeps partial content" passes.

**VF-002 (low, VIT-UX-006, owner ux).** `… -g "hint text"`. `#title` and `#pageUrl` have no `aria-describedby` pointing to their `.hint`.

**VF-003 (medium, VIT-UX-007, VIT-AC-004, owner ux).** `… -g "10,000"`. Pasting 10,000 characters into `#actual` keeps 1200 (the `maxlength` attribute) with no message. Expected: keep the text and show a length error, or explicitly announce the truncation. The requirement says "never silently truncate". The JS contract itself rejects over-length text; the HTML attribute defeats that check.

**VF-004 (high, VIT-AC-008, VIT-AC-015, VIT-NFR-004, owner ux + intake).** `node --test --test-name-pattern="agree on refusing credential" tests/adversarial/contract-divergence.test.mjs`, and `… -g "credential-looking"`. Typing `ghp_…`, `sk-…` or `password: …` into the legacy form produces a `github.com/…/issues/new?body=` URL containing the secret (it lands in browser history and in GitHub's logs before any human review). `service/report-domain.mjs` refuses the same text. Expected: one shared guard, refusing at Review.

**VF-005 (critical for enabling intake, VIT-AC-003, VIT-API-001, VIT-DOM-003, owner ux + intake).** `node --test --test-name-pattern="browser would send" tests/adversarial/contract-divergence.test.mjs`. `site/app.mjs` sends `{...normalizeReport(form), privacyAcknowledged:true, challengeToken}`. The site's `normalizeReport` has no `schemaVersion`, so the service returns 400 `Unsupported report version.`. The same body also fails `intake-request.schema.json` because a blank `pageUrl:""` violates `format: uri` (and `schemaVersion` is required). Turning `enabled:true` on as built would refuse **every** report. Not detected before because unit fixtures hand-craft `schemaVersion:"1.0"`.

**VF-006 (medium, VIT-DOM-003, owner domain).** `node --test tests/adversarial/schema-runtime.test.mjs`, cases "astral". The JSON Schema `maxLength` counts code points, while JS `.length` counts UTF-16 code units. A 120-emoji title is accepted by the schema and refused by the runtime ("summary is too long"). Pick one unit (code points or bytes) and apply it on both sides.

**VF-007 (medium, VIT-DOM-003, VIT-AC-004, owner domain).** Same file, divergent cases. Accepted by the schema but refused at runtime: whitespace-only title, NUL in title, `javascript:` and `data:` page URLs, credential text. Accepted at runtime but refused by the schema: `pageUrl:""`, `steps:null`, `pageUrl:null`, title padded to 121 and then trimmed. The published schema is therefore not the enforced contract.

**VF-008 (medium, VIT-API-002, VIT-AC-004/006, owner intake).** `node --test --test-name-pattern="bidi|NFC" tests/adversarial/intake-abuse.test.mjs`. A title of `​​` (renders empty), `invoice‮gnp.exe` (RTL spoof), C1 `\u009b` or a lone surrogate is accepted verbatim. `Café` NFC vs NFD under the same key gives 409 `request_conflict`. Expected: NFC normalisation before hashing, refusal or stripping of bidi controls, C1 characters and lone surrogates, and refusal of visually-empty text.

**VF-009 (high, VIT-AC-008, VIT-NFR-004, owner intake).** `node --test --test-name-pattern="credential formats|jsessionid" tests/adversarial/intake-abuse.test.mjs`. Accepted: `github_pat_…`, `AKIA…`, `xoxb-…`, JWTs, `Authorization: Bearer …`, `token=…`. `https://example.com/reset/ghp_…` is kept in the path. `;jsessionid=SECRET` is kept. The code says the guardrail is "not comprehensive DLP", but VIT-AC-008 needs at least the common provider formats, or a quarantine path.

**VF-010 (high, VIT-API-004, VIT-AC-006, owner intake).** `node --test --test-name-pattern="lost response" tests/adversarial/intake-abuse.test.mjs`. `makeIntake.submit` verifies the challenge **before** the idempotency lookup. With single-use tokens (Turnstile `siteverify` semantics), the identical request replayed after a lost response is refused with 403 `challenge_failed`, so the original receipt is unreachable at the transport-retry boundary. (The UI retries with a fresh token, and that control test passes; but API Gateway, Lambda or client-library retries reuse the body.) Suggested direction: look up the existing record by key before spending the token, without weakening challenge-before-**store** (M05 must still be killed).

**VF-011 (low, VIT-API-002, VIT-UX-007, owner ux + intake).** `node --test --test-name-pattern="page URL accepted by the site" tests/adversarial/contract-divergence.test.mjs`. A 2000-character URL containing spaces passes the site check (applied before sanitisation), becomes 3,960 characters after percent-encoding (" x" repeated 985 times), and is refused by the service. Check the length after sanitisation on both sides.

**VF-012 (medium, VIT-DOM-003/006, VIT-LCY-004, owner domain).** `node --test --test-name-pattern="representable|mapping" tests/adversarial/contract-divergence.test.mjs`. `triage.mjs` uses `reopened`, which `defect.schema.json` cannot represent. Intake impact labels ("Cannot use the feature", …) and defect codes (`cannot-use`, …) are disjoint and no mapping exists anywhere.

**VF-013 (low, VIT-API-005, VIT-AC-007, owner intake).** `node --test --test-name-pattern="inconsistent store" tests/adversarial/intake-abuse.test.mjs`. A store reply of `{created:false}` with no `existing` returns 409 "use a new submission", which tells the client the fault is theirs. Expected: 503 retryable. (No false receipt is issued; the safety property holds.)

**VF-014 (medium, VIT-LCY-001, VIT-AC-012, owner domain + governance).** `node --test --test-name-pattern="not in the documented" tests/adversarial/triage-lifecycle.test.mjs`. Edges executable in `triage.mjs` but absent from the candidate diagram in `VITIUM-OPEN-DECISIONS.md`: observation received→accepted-for-triage, received→rejected, accepted-for-triage→quarantined, accepted-for-triage→rejected; defect new→duplicate, new→not-reproducible, triaged→confirmed, reproducing→triaged, reproducing→not-reproducible, confirmed→duplicate, in-progress→triaged, duplicate→reopened, not-reproducible→reopened, reopened→triaged, reopened→reproducing. Either the doc or the code must change, and one machine-readable table must become the authority (VIT-LCY-001). Do not resolve this by editing the test's transcription.

**VF-015 (medium, VIT-LCY-004, VIT-AC-012, owner domain).** `node --test --test-name-pattern="duplicate requires|policy guard|non-empty string" tests/adversarial/triage-lifecycle.test.mjs`. `duplicate` accepted with no canonical-record reference. `resolved→closed` accepted with no evidence or policy reference. `evidenceId: {}` / `[]` / `1` / `true` / `"   "` all satisfy the evidence guard.

**VF-016 (medium, VIT-LCY-004, VIT-DOM-007, owner domain).** `node --test --test-name-pattern="truncated history|mutable history" tests/adversarial/triage-lifecycle.test.mjs`. `transition({revision:2, history:[]})` succeeds, so a caller can drop history. History events supplied by the caller are aliased into the frozen result (frozen array, mutable elements). Expected: `history.length === revision`, and a deep copy plus freeze of prior events.

**VF-017 (low, VIT-DOM-007, owner domain).** `node --test --test-name-pattern="occurredAt" tests/adversarial/triage-lifecycle.test.mjs`. `2026-99-99T99:99:99`, `…Z then anything` and `2026-02-30T00:00:00Z` are accepted.

**VF-018 (medium, VIT-NFR-008, VIT-REP-011, owner ux / ops).** `node --test --test-name-pattern="SRI" tests/adversarial/contract-divergence.test.mjs`. The `cdn.jsdelivr.net` stylesheet is version-pinned but has no `integrity`/`crossorigin`, so a CDN compromise can restyle or overlay the form. For reference, the npm tarball `dist/all.css` sha256 is `0a207c4da7c4381b0d9cdfb60c35d433d29ad0bcf9cba97eb20cbfb0faaf1895`. The owner must derive the SRI value from the bytes the CDN actually serves (which may differ in minification), not from this note.

**VF-019 (medium, VIT-VER-003, VIT-AC-023, owner all test owners).** `node tests/verification/mutation-appraisal.mjs --scratch=/tmp/vitium-mut --suites=unit`. Survivors: M06, M07, M09, M12, M13, M14, M15, M17, M18, M20 (10/20). Options: bring the adversarial checks into the default gate, or have owners add equivalents to their unit tests; also run the browser suite (now in `browser.yml`) as a required check.

## Observations (not findings)

- Without Forma CSS (CDN blocked), the page stays fully usable: no overflow, 0 axe violations, all controls labelled and operable. Typography falls back to `system-ui` (see the block-mode screenshots).
- With Forma 0.3.0 CSS, Forma's reduced-motion rule sets 0.01ms on every element. The suite treats durations of 10ms or less as no motion; the app's own transition is correctly gated by `prefers-reduced-motion: no-preference`.
- The page CSP blocks inline script, which is good. axe is injected through CDP `evaluate` for that reason (`addScriptTag` was refused by CSP).
- The CSP `connect-src` makes Chromium log a refused preload of the Forma stylesheet ("Connecting to … violates connect-src"). The stylesheet itself loads under `style-src`; this is console noise, not a failure.
- `form-action https://github.com` is present but the form never posts. Harmless.

## Fix round 1 (branch `p0/fix1-verify` from `p0/integration` @ `2b9de54`)

Scope: harness maintenance and adjudication only. No product code was changed.
Integrated start state: `npm run test:adversarial` 95 tests / 60 pass / **4 fail** / 31 todo.

### Adjudication of the 4 non-todo failures

| # | Test | Verdict | Authority | Action |
|---|---|---|---|---|
| 37 | "replay response does not reveal the original receivedAt … beyond the reference" | **Real defect → VF-020** (owner intake). The integrated receipt adds `disposition` and `notices`. `disposition: "quarantined"` gives an anonymous caller an oracle for the secret and vulnerability detectors: probe text, read the verdict. SEC-001 records the shape change but does not justify exposing the screening verdict. | FIX-ROUND-1 contract (replay returns the original receipt without revealing stored state); SEC-001 point 5 ("receipt is not a capability") | Assertion kept **unchanged**; marked `{ todo: "finding VF-020" }`. Confirmed passing on `p0/fix1-intake` (189fc60), whose `receiptFor` drops both fields with the same rationale. Remove the marker when that branch lands. |
| 78 | "an observation produced by makeIntake validates against observation.schema.json" | **Real defect → VF-021** (owner domain). makeIntake emits `disposition`, `screening` and `reviewQueuePk: "QUEUE#quarantined"`; the closed schema refuses them ("must NOT have additional properties"). The schema is the stale side. | FIX-ROUND-1 contract, "Observation shape" | Assertion kept **unchanged**; marked `{ todo: "finding VF-021" }`. Confirmed passing on `p0/fix1-domain` (9bb1467). |
| 81 | "every documented edge is executable by an authorised actor" | **Superseded test semantics, not a defect.** The test drove edges from the prose diagram in VITIUM-OPEN-DECISIONS.md and sent `classification` on every edge. The table now rejects undeclared fields (`unexpected_field`), which is stricter. DOM-001 decision 1 makes `schemas/lifecycle/transitions.v1.json` the single edge authority. | DOM-001 decisions 1 and 4 | Rewritten to read the table **directly** (independently of the service loader) and supply exactly each rule's obligations. Strengthened: one new test asserts that every evidence, field and role obligation is refused when missing (including `unspecified` evidence); another asserts that every pair absent from the table is refused even with administrator role, every evidence kind and every field. |
| 90 | "reopening preserves the closure event and the prior history unchanged" | **Superseded test semantics, not a defect.** Reopen now requires `new-occurrence` or `triage-correction` evidence (`missing_evidence`). | DOM-001 decision 4 and "Consequences" | The test now first asserts that reopen **without** evidence and with non-qualifying (`supporting`) evidence is refused, then supplies `new-occurrence`. It still asserts the prior two events are deep-equal **and** byte-identical, the closure event and resolution evidence are retained, history is frozen and the input is not mutated. Added: the reopen event's `reopens` points at the closure (sequence 2). Close evidence follows the table rule, so the test also passes on `p0/fix1-domain`, where `resolved → closed` gains an evidence obligation. |

### Findings re-checked on the integrated tree

| Finding | State on `p0/integration` | Closing commit | Marker change |
|---|---|---|---|
| VF-001 error summary + `aria-describedby` | **closed by integration** (browser, 3 viewports) | 6d2be13 | `test.fail` removed, assertion unchanged |
| VF-002 hints associated | **closed by integration** | 6d2be13 | `test.fail` removed |
| VF-003 silent truncation | **closed by integration** | 6d2be13 | `test.fail` removed |
| VF-013 inconsistent store reply → 503 | **closed by integration** | fa59123 | `todo` removed |
| VF-014 undocumented edges | **closed by integration**: every executable pair is a table edge | 76fd040 (table), DOM-001 | Test re-based on the table (see #81), no marker |
| VF-015 duplicate needs canonical ref | **closed by integration**; strengthened with malformed, wrong-kind and self references plus a positive control | 76fd040 | `todo` removed |
| VF-015 `evidenceId` must be a real string | **closed by integration**, plus positive control | 76fd040 | `todo` removed |
| VF-015 `resolved → closed` needs evidence | open on integration; passes on `p0/fix1-domain` (8993af7) | n/a | `todo` kept |
| VF-016 truncated history | **NOT closed.** It passed only vacuously (`missing_evidence`, because reopen now needs evidence). With the required evidence supplied, `{revision: 2, history: []}` is still accepted. Passes on `p0/fix1-domain`. | n/a | Test corrected; `todo` kept |
| VF-016 aliased history events | open; passes on `p0/fix1-domain` | n/a | `todo` kept |
| VF-008 invisible/bidi | open: zero-width-only titles are stored verbatim (C1/bidi now refused). Passes on `p0/fix1-intake`. | n/a | Test now observes the full intake path |
| VF-009 credential formats | **partially closed**: PAT, AKIA, xoxb, JWT and Bearer are redacted and quarantined (fa59123). `token=…` in free text and `;jsessionid=` in page URLs still persist. Passes on `p0/fix1-intake`. | n/a | Test now asserts SEC-001 semantics (never stored or echoed, record quarantined) instead of "refused" |
| VF-010 lost-response retry | open; passes on `p0/fix1-intake` (06af070) with the harness store modelling the new read-only `lookup` port | n/a | `todo` kept |
| VF-004, VF-005, VF-006, VF-007, VF-011, VF-012, VF-017, VF-018 | open on integration (VF-006/007/012/017 pass on `p0/fix1-domain`) | n/a | `todo` kept |

Why tests were re-expressed for SEC-001 (VF-008/009): the integration replaced "refuse credentials" with "redact then quarantine" (SEC-001 decision 1). The tests now assert that the canary never appears in any stored record or reply **and** that the record is quarantined. This is no weaker for confidentiality, and it adds the quarantine obligation.

### Harness changes
- `tests/verification/canaries.mjs`: every fake credential is assembled at runtime. `node scripts/secret-scan.mjs` reports no findings in `tests/adversarial/`, `tests/browser/` or `tests/verification/`.
- `tests/verification/contracts.mjs`: the in-memory store implements the read-only `lookup(pk)` replay port (receipt projection only), matching `service/adapters/dynamodb-store.mjs` on `p0/fix1-intake`.
- Body-size tests follow `http.MAX_BODY_BYTES`, bounded to [16384, 24576], the documented contract range.
- Mutation runner:
  - Copies the whole tree (generated governance state included).
  - Scores kills **differentially** against an unmutated control run, so the 7 pre-existing `npm test` failures on integration cannot count as kills. Self-tested in `harness-self.test.mjs`.
  - 44 mutants (was 20), retargeted to `service/lifecycle.mjs`, `service/redaction.mjs`, `site/state.mjs`, `site/private-intake.mjs` and `site/view.mjs`.
- Browser spec changes:
  - Locates `<summary>` by tag.
  - Accepts focus on the error summary, which the stricter VF-001 test requires.
  - Accepts focus anywhere inside `#review` (the state machine focuses the `review-title` heading).
  - Tolerates a private control that is absent from the DOM while the gate is disabled (template-only; stronger than "hidden").

### Mutation appraisal on `p0/integration` (unit + adversarial, differential)

Control: `npm test` exit 1 with 7 pre-existing failures; adversarial exit 0.
- Killed: **41 / 44**. Unit alone kills 39/44. Adversarial alone kills 22/44. M12 (HTML-only product) and M06 (truthy challenge) are killed only by adversarial.
- **Survivors after the first run:** M24 (page-URL path not screened), M38 (reducer skips receipt re-validation), M43 (challenge not required before send).
- New `tests/adversarial/reducer-and-screening.test.mjs`: re-running with `--only=M24,M38,M43` kills M24.
- M38 and M43 are **equivalent mutants** at the public API:
  - `classifyOutcome` already calls `parseReceipt` on the same raw outcome, so the reducer's second check computes the same value.
  - `buildPrivateRequest` independently refuses a missing or short token with the same `challenge_required` code.
  - Both remaining guards are defence in depth. They are reported, not filed as findings.

### New findings this round
- **VF-020** (medium, VIT-AC-009, SEC-001 point 5, owner intake): the receipt exposes `disposition` and `notices`, an oracle for the screening detectors. Repro: `node --test --test-name-pattern="replay response does not reveal" tests/adversarial/intake-abuse.test.mjs` (marked todo).
- **VF-021** (medium, VIT-DOM-003, owner domain): `observation.schema.json` refuses the observation shape makeIntake produces. Repro: `node --test --test-name-pattern="observation produced by makeIntake" tests/adversarial/schema-runtime.test.mjs` (marked todo).
- **VF-022** (low, VIT-NFR-004, owner ops): `scripts/secret-scan.mjs` scans the gitignored `tests/browser/.output/`. Playwright's `error-context.md` and HTML report contain the runtime-assembled canary from the VF-004 test, so a local or CI scan after a browser run reports about 10 false positives. Add `.output` (or honour `.gitignore`) in `EXCLUDED_DIRS`, and do not run the scanner over browser artifacts.

## Fix round 2: final independent verification pass (branch `p0/fix2-verify` from `p0/integration` @ `25ce853`)

Environment for every run below: local sandbox, Node v22.22.0, npm registry reachable. Browser: Chromium 153.0.8010.0 from npm `@sparticuz/chromium@153.0.0` (installed `--no-save`), driven by `@playwright/test@1.63.0`. Forma CDN (jsDelivr) is **blocked**. `test:integration` runs against the dynalite emulator (not real DynamoDB). **These are local results. The CI legs (`test.yml`, `p0-service.yml`, `browser.yml` cdn/blocked) are pending until the integrator reports CI run IDs.**

### Coordinator numbers re-run independently on `25ce853` (before any change here)

| Command | Observed |
|---|---|
| `npm test` | 207 tests, 207 pass, 0 fail, 0 todo |
| `npm run test:adversarial` | 101 tests, 87 pass, 0 fail, 14 todo |
| `npm run test:integration` | 20 tests, 20 pass |
| `node scripts/secret-scan.mjs` | 293 text files, 0 blocked |

All match the coordinator's report. I did not re-run the F# suite or `conditor`/`praxis`/`ordo` verification in this pass (outside the harness scope; not re-witnessed here).

### Marker adjudication

Each remaining marker was run **unmarked**. A marker was removed only if the test passed with its assertion unchanged.

| Finding | Unmarked result on `25ce853` | Closing commit | Action |
|---|---|---|---|
| VF-004 (site/service credential parity, adversarial + browser `test.fail`) | pass (adversarial; browser at 3 viewports) | 9e5ac50 (`site/credential-guard.mjs`) | markers removed |
| VF-005 (browser wire body accepted by service + schema) | pass (2 tests) | 9e5ac50 (client omits blanks) + 9bb1467 (schema) | markers removed |
| VF-008 (invisible/bidi; NFC replay) | pass (2 tests) | 06af070 + 9bb1467 | markers removed |
| VF-009 (credential formats; `;jsessionid=`) | pass (2 tests) | 06af070 | markers removed |
| VF-010 (lost-response retry) | pass | 06af070 | marker removed |
| VF-012 (defect states; impact mapping) | pass (2 tests) | 9bb1467 | markers removed |
| VF-020 (receipt exposes screening verdict) | pass | 189fc60 | marker removed |
| VF-021 (observation schema vs makeIntake) | pass | 9bb1467 | marker removed |
| VF-006, VF-007, VF-015, VF-016, VF-017 | pass (the integrator had already removed these markers; re-run unmarked here) | 9bb1467 / 8993af7 | confirmed closed |
| **VF-011** page URL | **fail**, see adjudication | n/a | kept, test strengthened |
| **VF-018** SRI | **fail** (no `integrity` attribute) | n/a | kept; blocked on a CDN byte check (UX-0001 gap UX-G1) |

**VF-011 adjudication.** The UX claim is correct for the site. `site/submission.mjs` now measures the **sanitised** URL and refuses it with an actionable message ("3,960 characters after removing the query and fragment…"). VIT-UX-007 allows that, so the original single-input test was asking for the wrong thing: it required the site to accept. I rewrote the test as the actual invariant over a 6-input corpus: *if the site accepts a URL, the service accepts it; and the service never stores a page URL over 2,000 characters*. The site half passes. The service half fails. `service/report-domain.mjs` checks `codePoints(raw.pageUrl) > 2000` **before** sanitising, so `https://example.com/` followed by 990 × `é` (1,010 code points) is accepted and stored as a **5,960-character** `pageUrl` (each `é` becomes `%C3%A9`). This is a real defect in the service (owner domain/intake). It also breaks the schema/runtime agreement for stored observations. Repro: `node --test --test-name-pattern="accepted by the site" tests/adversarial/contract-divergence.test.mjs` (todo VF-011).

**Browser "empty submit keeps partial content" vs VF-001 adjudication.** UX is right that the two tests contradicted each other. VIT-AC-001 ("actionable error focus") and VF-001 require focus on the error summary, so the baseline "first invalid control" expectation is superseded. The test now requires focus on `#feedback`, the summary to be visible and a link to `#product`. This is the stricter behaviour, and both tests now agree.

**VF-022 (ops, low): still open.** `scripts/lib/secret-scan.mjs` `EXCLUDED_DIRS` is `[".git","node_modules",".aws-sam"]`; it does not exclude gitignored output. Repro: after `npm run test:browser`, write any runtime-assembled canary into `tests/browser/.output/x.md` and run `node scripts/secret-scan.mjs`. Result: `1 blocked … tests/browser/.output/vf022-probe.md`. A clean browser run currently leaves no text match, because the VF-004 test now passes and Playwright writes no error-context, so the scan is 0. Any future browser failure involving canaries will re-trigger it. `test.yml` scans `.` after checkout (no browser output there), so CI is unaffected today.

### Code review of the integrated replay path and related modules

Read in full: `service/intake.mjs`, `service/http.mjs`, `service/errors.mjs`, `service/redaction.mjs`, `service/report-domain.mjs`, `service/adapters/{dynamodb-store,turnstile-challenge,safe-log}.mjs`, `service/lifecycle.mjs`, `service/triage.mjs`, `service/triage-cli.mjs`, `site/state.mjs`, `site/private-intake.mjs`, `site/credential-guard.mjs`, `site/submission.mjs`, plus `infra/aws/template.yaml` (GetItem policy). Probe: `scratchpad/verif/probe-replay.mjs`. The resulting tests are in `tests/adversarial/replay-path.test.mjs`.

| Question | Finding |
|---|---|
| Can replay bypass the challenge for a NEW record? | **No.** An unknown key with no token gives 403 `challenge_required`. An unknown key with a spent token gives 403 `challenge_failed`. A fresh key with an identical body is a new request and also gets 403. The record count stays at 1. Replay never calls `putOnce` and never calls the verifier (asserted: 5 replays, 0 verifier calls). |
| Does replay echo stored content? | **No.** The replay body has exactly `{schemaVersion, reference, receivedAt, status, replayed}`. The conflict body has exactly `{code, category, retryable, message}`. Stored text never appears. The DynamoDB replay read projects 4 attributes, and the IAM `dynamodb:Attributes` condition restricts GetItem to them (integration test I-07 kills mutant M55). |
| Is the receipt a bearer credential? | **No.** There is no read or status route (template: `POST /api/v1/reports` only; http adapter: every other method/path gets the same 404). Replaying requires the full body **and** the idempotency key; the reference alone grants nothing. |
| Can an attacker without the body learn anything? | **Yes, finding VF-023 (medium, owner intake).** With only an idempotency key and **no challenge**: unknown key → **403** `challenge_required` (121 bytes); known key + any other body → **409** `request_conflict` (174 bytes); known key + exact body → **200** with the receipt. That is an existence oracle for a key, reachable without solving a challenge. Keys are client-side v4 UUIDs, so the risk depends on the key leaking (shared device, logs, a proxy), but the contract requires that a conflict "leaks nothing". Fix direction: when the key is known and the hash differs, require a valid challenge before answering, or answer `challenge_required` until one is supplied. Same-hash replay can stay unchallenged, because the caller already proves possession of the body. Test: `replay-path.test.mjs` "unchallenged caller cannot tell…" (todo VF-023). Timing: the unknown-key path makes one store read and then returns before the verifier call; the known-key path also makes one store read. Timing alone does not separate them beyond the status code; the status difference is the leak. |
| Unchallenged storage reads (cost amplification) | **Observation, VF-024 (low, owner intake/ops).** Every syntactically valid request with a fresh key costs one strongly consistent GetItem **before** any challenge (probe: 20 fresh-key unchallenged requests gave 20 store reads and 0 verifier calls). The API Gateway throttle (2 rps / burst 4) and Lambda concurrency 4 bound it. SEC-001 already records that per-source throttling is not enforced. Acceptable at P0 if recorded; consider checking the token **shape** (already done) plus a cheap pre-filter before the read. |
| Regex DoS in redaction / site guard | Not found. The worst case among 6 adversarial 1.2 KB inputs (PEM without END, digit runs, `b:` repetitions, long Bearer) is ≤ 2 ms in both `redaction.mjs` and `credential-guard.mjs`. |
| Lifecycle / triage CLI | No new defects. `ownHistory` deep-clones and checks the event count against the revision; instants are range-checked; the CLI uses the strict provenance path and `UpdateItem` with a revision + state condition. Note: the CLI treats every IAM principal allowed on the table as `triager` (documented as provisional, Fides pending); that is not a new finding. |

### Mutation appraisal on `25ce853`

Command: `node tests/verification/mutation-appraisal.mjs --scratch=<scratch> --suites=unit,adversarial`, then `--suites=integration --only=<survivors>`, then `VITIUM_LOCAL_CHROMIUM=sparticuz … --suites=browser --only=M01,M02,M12,M17,M18,M20,M42,M43,M52,M53`. 55 mutants (8 re-anchored to moved code; M46–M56 new for the round-1 fixes). Kills are differential: the control was green for unit, adversarial, integration and browser.

- `npm test` alone kills **47 / 55**; `test:adversarial` alone kills **32 / 55**. Unit + adversarial together kill **50 / 55**.
- Adding `test:integration` kills M55 (replay projection). Adding the browser suite kills M01, M02, M17, M18 and M20, which are already killed by unit.
- **Final survivors (4), all equivalent mutants** (the guard is enforced again by an independent layer on the same input):
  - **M23**: intake's C1/bidi refusal removed. `report-domain.mjs` `UNSAFE_CLASS` refuses the same characters.
  - **M48**: intake's NFC normalisation removed. `report-domain.mjs` NFC-normalises accepted text before hashing.
  - **M38**: reducer's receipt re-validation removed. `classifyOutcome` already runs `parseReceipt` on the same raw outcome.
  - **M43**: reducer's challenge check removed. `buildPrivateRequest` refuses a missing or short token with the same code.
- These survivors are recorded, not findings. If one of the duplicate layers is later deleted, the corresponding test suite still catches the remaining one.

### Browser suite on `25ce853` (after the marker and focus updates on this branch)

| Mode | Command | Result |
|---|---|---|
| CDN blocked | `VITIUM_LOCAL_CHROMIUM=sparticuz npm run test:browser` | **66 passed**, 0 failed, 0 flaky, 0 `test.fail` remaining (1.8 min) |
| Forma 0.3.0 CSS from the npm tarball at the pinned URL | `… VITIUM_FORMA_CSS_FILE=<tarball>/package/dist/all.css npm run test:browser` | **66 passed**, 0 failed (1.8 min) |

In both modes:
- axe-core 4.13.0: **0 violations** (initial and review, 320, 375 and 1280). `incomplete`: `color-contrast` on 1–2 `aria-hidden` decorative glyphs, which still needs manual review.
- scrollWidth equals clientWidth in every state at every width.
- No request reached github.com, the intake host or Cloudflare (all aborted and logged).

### Findings summary after round 2

- **Closed (with closing commit):**
  - VF-001, VF-002, VF-003: 6d2be13 / 281655e
  - VF-004: 9e5ac50
  - VF-005: 9e5ac50 + 9bb1467
  - VF-006, VF-007, VF-012, VF-021: 9bb1467
  - VF-008, VF-009, VF-010: 06af070
  - VF-013: fa59123
  - VF-014: 76fd040
  - VF-015, VF-016, VF-017: 8993af7
  - VF-020: 189fc60
  - VF-019 (suite sensitivity): unit-suite survivors fell from 10/20 to 8/55, and every non-equivalent mutant is now killed by some suite.
- **Open:**
  - **VF-011**: service measures page-URL length before sanitising and stores up to about 6,000 characters. Owner domain (`service/report-domain.mjs`).
  - **VF-018**: no SRI. Owner ux/ops; blocked on a jsDelivr byte check from an unblocked network (UX-0001 UX-G1).
  - **VF-022**: scanner covers gitignored output. Owner ops.
  - **VF-023 (new)**: unchallenged key-existence oracle on the replay path. Owner intake.
  - **VF-024 (new, low)**: unchallenged store read per request. Owner intake/ops; record in SEC-001 or add a pre-filter.
