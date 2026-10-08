# Vitium reporter: Limen (F#/WASM) migration plan

- **Status:** plan only. Nothing here is implemented. Issue #6.
- **Date:** 2026-10-08
- **Source read:** `kemiller2002/limen` at `9b54737` (package `@echelon-foundry/limen` 0.7.1; npm `latest` is 0.7.1 with attestations present, provenance not verified here).
- **Why it was not attempted:** the target needs the .NET SDK with the `Microsoft.NET.Sdk.WebAssembly` workload plus Conditor-qualified Limen packages. NuGet is blocked in this environment, and no Limen release is qualified in `conditor.json`. Introducing an unqualified dependency would breach the mission's no-shortcut rules.

## 1. What Limen is, as it bears on Vitium

Limen splits a page into a **kernel**, which does browser things (DOM bindings, `fetch`, storage, history and optional capability packs such as focus), and an **engine**, which owns state, transitions, validation and projection. They exchange only JSON:

```text
DOM event → kernel → SemanticEvent { name, value, key, checked, submitter }
          → engine.transition(state, event) → (state', effects)
          → EngineToBrowserMessage { view: ViewState, effects: EffectRequest[], cancellations }
kernel performs effects → EffectResult { HttpResult { correlationId, outcome } }
          → engine.transition → …
```

The Http `EffectOutcome` is `Success{status, body}`, `Failure{network|aborted|invalid-response|too-large}`, `Cancelled` or `OutcomeUnknown{timeout-after-dispatch|connection-lost}`, and **OutcomeUnknown is never collapsed into Failure**. Focus is an optional capability pack (`limen.focus`, `focusFirst` / named `data-focus-target`). The F# reference engine libraries include `Limen.Forms`, `Limen.Http` (retry policy: an unknown non-idempotent request is never retried blindly) and `Limen.Outbox` (idempotency id per operation).

## 2. How the current JavaScript already maps onto that seam

The Phase E refactor shapes the JavaScript as a Limen engine, so the port is 1:1:

| Vitium JS (today) | Role | Limen equivalent | F# target |
|---|---|---|---|
| `site/state.mjs` `transition(state, event) -> {state, effects}` | engine transitions | engine `transition` | `Vitium.Reporter.Engine.transition : State -> Command -> State * Effect list` |
| `site/state.mjs` events (`ReviewRequested`, `EditRequested`, `CancelRequested`, `FieldChanged`, `SubmitRequested`, `ChallengeSolved`/`Expired`/`Unavailable`, `SubmitCompleted`, `ResetRequested`, `HandoffOpened`) | commands | `SemanticEvent` names (`data-event`) plus `EffectResult` | `Command` discriminated union |
| `phase` string plus record | state | engine state | `Phase = Draft \| HandoffReady of url \| Reviewing of Attempt \| Submitting of Attempt \| Accepted of Receipt \| UnderReview of Receipt \| Rejected of Attempt * RejectError`. The DU makes "accepted without receipt" unrepresentable, which today is only test-enforced. |
| `site/submission.mjs` `validateReport`, `tryBuildIssueUrl`, `formatIssueBody` | validation and legacy handoff formatting | engine library | `Vitium.Reporter.Report` module (`Result<Report, FieldError list>`); could adopt `Limen.Forms` once qualified |
| `site/private-intake.mjs` `buildPrivateRequest` | effect construction | `HttpEffectRequest { kind:"Http", correlationId, method, url, headers, body, timeoutMs, response:"json", credentials:"omit" }` (already the same shape) | `Effect.Http` built through `Limen.Http.Request` |
| `site/private-intake.mjs` `classifyOutcome`, `parseReceipt`, `ERROR_CATALOGUE` | outcome interpretation | engine handling of `HttpResult` | `Outcome -> Classification` (total match over the outcome DU) |
| `site/private-intake.mjs` `makeHttpPerformer` | performs `fetch` and maps exceptions to `OutcomeUnknown`/`Failure` | **deleted**: the kernel's built-in Http family does this | none |
| `RenderChallenge` / `ResetChallenge` effects and `makeTurnstileChallenge` in `app.mjs` | third-party widget | **governed adapter** (Limen `docs/42-adapters.md`); there is no core family | adapter with no application authority. It reports `ChallengeSolved(token)` as a semantic event. The token is a single-use public value, not a secret. |
| `site/view.mjs` `project(state)` | projection | `ViewState` (named primitives and lists) | `project : State -> ViewState` |
| `site/view.mjs` `applyView` | DOM writes | kernel bindings: `data-bind-text`, `data-bind-hidden`, `data-bind-*` attributes, `data-each` for the error list | **deleted**; replaced by binding attributes in `index.html` |
| focus targets (`state.focus = {target, seq}`) | focus policy | `limen.focus` capability request with `data-focus-target="review-title"` etc. | `Effect.Capability(focus, focusFirst target)` |
| live region `#status` text | announcement | projected `announcement` bound to a `role=status` element | unchanged HTML |
| `app.mjs` `startReporter` | host wiring | `new BrowserKernel(transport, document, diagnostics, { capabilities:[focusCapability()] })` with `DotnetWasmTransport` | a small `main.ts`/`main.mjs` plus a `[JSExport] Dispatch` C# shim (as in Limen's `site/fsharp/Limen.Site.Wasm/Program.cs`) |
| `site/public-config.mjs` | deployment gate | passed to the engine in `Initialize` (or a projected constant) | unchanged; must stay `enabled:false` until approved |

Invariants the port must keep, each covered today by node tests that should become F# console test runners (no xunit/Expecto):

1. `Accepted`/`UnderReview` require a server receipt that `parseReceipt` validates (`tests/site-state.test.mjs`, including the 400-run seeded exploration).
2. Typed values survive every error, Edit and Cancel (VIT-UX-007).
3. Retry reuses the idempotency key. Changed content or `request_conflict` gets a new key.
4. `OutcomeUnknown` is reported as "could not confirm", never as "failed".
5. The legacy GitHub path has no network effect and no submitted state (VIT-INT-001).
6. Client limits equal the server contract (`tests/site-intake-contract.test.mjs`). In F#, share the limits module between the client engine and the server domain instead of mirroring them.

## 3. Non-destructive migration steps

Each step is independently reviewable and leaves the reporter working.

1. **Qualify dependencies (blocker; operator or lifecycle agent).** Add `limen` (TypeScript kernel `@echelon-foundry/limen` at an exact version) and the .NET WASM toolchain to Conditor qualification. Record lock and receipt evidence produced by the real tool. Add the npm dependency with an exact version and lockfile integrity. Today Vitium has no npm runtime dependencies.
2. **Port the engine in F#, out of band.** Create `app/Vitium.Reporter.Engine/` (net8.0 class library, FSharp.Core only). Port `state.mjs`, `submission.mjs` and the pure parts of `private-intake.mjs`. Write a console test runner that replays the same fixtures as the node tests: export the JS test vectors as JSON so both implementations run the **same** vectors, as Limen's conformance packs do.
3. **Differential check.** In CI, run the JS reducer and the F# engine (compiled for the console) over the same random event sequences and require identical projections. This proves 1:1 behaviour before any browser switch.
4. **Add the WASM host behind a flag.** Build `Vitium.Reporter.Wasm` (C# `[JSExport] Dispatch` shim only), and add a second entry page (`site/limen.html`) that uses Limen `BrowserKernel` + `DotnetWasmTransport` with `data-*` bindings over the **same** HTML structure, ids and `data-testid`s. `index.html` stays on the JS reducer.
5. **Run the browser suite against both pages.** The verification agent's Playwright and axe suite (320px, 375px, desktop, keyboard-only, reduced motion) must pass identically on `index.html` and `limen.html`. Compare payload size and cold-start time; WASM startup cost matters for a one-shot form.
6. **Switch.** Point `index.html` at the Limen host. Keep the JS reducer modules for one release as a no-JS-WASM fallback, chosen by the `fatal-fallback` pattern (Limen `docs/44-fatal-fallback.md`) if the runtime fails to load. The fallback stays legacy-GitHub-only unless the private gate is approved.
7. **Retire the JS engine** after a release with no regressions. Delete `state.mjs`, `view.mjs` and `applyView`. Keep `submission.mjs` only if the server still imports its list constants; otherwise move shared constants into the F# domain project (coordinate with the typed-domain agent's product registry).

## 4. Risks and open points

- **CSP:** .NET WASM needs `script-src 'wasm-unsafe-eval'` and same-origin `_framework/` assets. The CSP meta must change in step 4, and that needs security review.
- **Bundle weight:** the .NET runtime is several MB, which is much heavier than today's no-dependency page. The fatal-fallback path matters for slow connections (VIT-UX-010, P2).
- **Challenge widget:** Turnstile is third-party script. Under Limen it must stay a governed adapter that holds no application state.
- **Shared contract:** the server is JavaScript today. When the typed-domain agent's F# domain lands, client and server should share one F# limits and error-code module, which replaces the mirrored constants and the drift test.
