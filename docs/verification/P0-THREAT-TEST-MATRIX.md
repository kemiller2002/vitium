# Vitium P0 threat / test matrix

Status: **phase-1 independent verification against baseline `main` @ `bba1d59`**. Branch `p0/verification-harness`.
Author role: independent verification agent (VIT-P0-2026-10-08). This document does **not** certify code written by other agents and promotes **no** scenario to `verified-passed`: every P0 scenario below also depends on deployment, operator or governance evidence that does not exist.

Status vocabulary follows `docs/requirements/VITIUM-ACCEPTANCE.md`: `not-started`, `in-progress`, `blocked`, `executed-failed`, `verified-passed`. A check line can be `executed-pass`, `executed-fail (finding)` or `not-executed`.

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
