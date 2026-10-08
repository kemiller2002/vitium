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
