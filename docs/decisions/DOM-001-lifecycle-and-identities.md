---
id: DOM-001
title: Candidate lifecycle table, typed identities and product registry
status: proposed
date: 2026-10-08
owner: vitium (typed domain agent, mission VIT-P0-2026-10-08)
requirements: [VIT-DOM-001, VIT-DOM-002, VIT-DOM-003, VIT-DOM-004, VIT-DOM-005, VIT-DOM-006, VIT-LCY-001, VIT-LCY-002, VIT-LCY-003, VIT-LCY-004, VIT-API-002, VIT-INT-001]
acceptance: [VIT-AC-010, VIT-AC-011, VIT-AC-012]
open-decisions: [VIT-OQ-002, VIT-OQ-011, VIT-OQ-012, VIT-OQ-013]
issue: "#8"
---

# DOM-001: Candidate lifecycle table, typed identities and product registry

**Status: proposed.** These are provisional, reversible engineering choices. **Ordo
authority is pending.** Nothing here is an Ordo-approved transition policy. The table
says so in machine-readable form (`authority: "vitium-domain-candidate"`,
`ordoAuthorized: false`), and both implementations refuse any table that claims otherwise.

## Context

Before this change, `service/triage.mjs` hard-coded a transition graph. The F# core did
not exist. `defect.schema.json` (v1) mixed identity kinds: `VIT-0001` defect ids looked
like `VIT-<hex>` receipt references. It also stored GitHub URLs as first-class fields and
had `severity: "unassessed"` as a default. VIT-OQ-011 recommends keeping the v1 states,
formally specifying guards and special dispositions, and separating fix facts.

## Decisions (provisional)

1. **There is one machine-readable lifecycle authority:** `schemas/lifecycle/transitions.v1.json`,
   with a JSON Schema in `transitions.schema.v1.json`. JS (`service/lifecycle.mjs` via
   `service/triage.mjs`) and F# (`domain/Vitium.Domain`) both evaluate this table. Neither
   hard-codes the graph. Shared cases are in `schemas/lifecycle/transition-cases.v1.json`.
2. **Separate machines.** Observation: `received → quarantined | accepted-for-triage | rejected`,
   `quarantined → accepted-for-triage | rejected`, `accepted-for-triage → classified | quarantined | rejected`.
   `classified` and `rejected` are terminal. A state belongs to exactly one machine.
3. **Defect machine** = the v1 states plus `reopened` and the explicit terminal
   dispositions `expected-behavior`, `declined` and `superseded`. `duplicate` and
   `not-reproducible` are kept. The legacy edges from `service/triage.mjs` are kept,
   including `new → not-reproducible`. Additions: `triaged → expected-behavior|declined|superseded`,
   `reproducing → expected-behavior`, `confirmed → declined|superseded`, and reopening
   from every disposition.
4. **Every transition needs a bounded reason.** Proof obligations are table data:
   - `confirmed` needs `reproduction` evidence.
   - `not-reproducible` needs `reproduction-attempt`.
   - `expected-behavior` needs `specification-reference`.
   - `declined` needs `decision-record`.
   - `duplicate` needs `duplicateOf` (a `DEF-` id, not itself).
   - `superseded` needs `supersededBy`.
   - `resolved` needs `verification-run` **and** the `verifier` or `administrator` role (VIT-OQ-012).
   - `reopened` needs `new-occurrence` or `triage-correction` evidence. The new event's
     `reopens` points at the latest disposition event and its evidence. History is append-only
     and is never rewritten (VIT-AC-012).
   - The `unspecified` evidence kind (untyped legacy evidence) never satisfies an obligation.
5. **Promotion is a separate, authorized action** (VIT-LCY-002, VIT-OQ-013). Only a
   `classified` observation can be promoted, by a triager or administrator, with a reason
   and a caller-supplied new `DEF-` id. Promotion creates a new defect in `new` and adds a
   link event to the observation. The observation keeps its kind, identity and state.
   `transition()` has no edge from any observation state into a defect state.
6. **Fix facts are events, not states** (groundwork for VIT-VER-005, P1): `fix-proposed`,
   `code-merged`, `build-passed`, `release-published`, `deployment-observed`,
   `verified-resolved` and `reporter-confirmed`. Recording a fact increments the revision
   but never changes state.
7. **Commands need actor id + provenance class + role.** Commands may come from the
   `authenticated-human`, `application`, `ci` or `agent` classes. `anonymous-human` is a
   valid reporter provenance but cannot command triage. The provisional operator CLI's
   legacy call shape (no provenance) is recorded as provenance `unrecorded`, so it is never
   invented. The strict API refuses `unrecorded`.
8. **Distinct identities** (VIT-DOM-001/002): `OBS-<32 hex>` (internal observation),
   `VIT-<32 HEX>` (opaque external receipt reference, unchanged from intake),
   `DEF-<digits>` (defect), registry `productId`, `actorId`, evidence ref and work-item ref
   (`system` + `ref`). The patterns do not overlap, so one kind cannot stand in for another.
9. **Separate judgement fields** (VIT-DOM-006): `reportedImpact` (reporter),
   `triage.severity`, `triage.priority`, `triage.confidence` and `triage.classification`.
   Each is absent until a triager sets it, and none is derived from another.
   `severity: "unassessed"` in v1 migrates to *absent*.
10. **Product registry** `schemas/products.v1.json` (VIT-DOM-004). It contains exactly the
    13 entries that `service/report-domain.mjs` and `site/submission.mjs` had at `bba1d59`.
    No product was added. The one alias set beyond ids and display names is
    `Ordo ← "State Directed Engineering", "SDE"`, sourced from the Ordo README. "Other / not
    sure" is the explicit `unknown` entry. Unresolvable names are refused at intake. In
    migrated historical records they stay `status: "unmapped"` with the original text and
    are never reassigned. The site and service keep constant lists (for the Pages and
    Lambda packaging boundaries), and a test fails if the three diverge.
11. **v2 record schemas** (`observation.v2.schema.json`, `defect.v2.schema.json`) are
    versioned (`schemaVersion: "2.0"`), closed (`additionalProperties: false` throughout)
    and free of GitHub-specific fields. The pure `migrate` in `service/domain-records.mjs`
    upgrades v1 records deterministically and keeps the full original under
    `migration.original`. The observation fixture was produced by running the baseline
    intake and triage code.

### Fix round 1 additions (2026-10-08, still proposed)

12. **Report text contract: one definition, three enforcers** (VF-006, VF-007, VF-008, D-06).
    The rules live once in `service/report-domain.mjs` (`TEXT_PATTERNS`, `WHITESPACE_CLASS`,
    `UNSAFE_CLASS`, `CREDENTIAL_PATTERN`). They are copied literally into
    `schemas/intake-request.schema.json` and `schemas/report-text-rules.v1.json`. The F# core
    compiles the rules file. `tests/domain-report-contract.test.mjs` fails if any copy differs.
    `schemas/report-cases.v1.json` (36 cases) is replayed against the JS runtime, the JSON
    Schema (ajv) and `Report.normalise` in F#.

    | VF-007 case | Decision | Why |
    |---|---|---|
    | whitespace-only title | refuse (schema + runtime) | A required field must contain at least one visible character. Zero-width, word-joiner and BOM-only text also counts as empty (VF-008). |
    | NUL / control in text | refuse | The schema pattern now excludes the same control/bidi set the runtime refuses. |
    | `javascript:` / `data:` page URL | refuse | The schema pattern allows only `http(s)://host...`. The runtime additionally parses the URL. |
    | credential-looking text | refuse in both | The schema carries the same credential lookahead the runtime applies. Intake still redacts and quarantines first (SEC-001), so this only fires for direct domain callers. |
    | `pageUrl: ""` | **accept as "not provided"** in both | Lowest-risk reversible choice. It matches what older clients send, it stores no data, and the client now omits blanks (VF-005). |
    | `steps: null`, `pageUrl: null` | **refuse** in both | `null` is not a string. Optional means *absent*. Accepting null would weaken the closed schema. |
    | title padded to 121, then trimmed | **refuse** in both | Length is measured on the raw value, as JSON Schema does. Trimming first would make the schema and runtime disagree. |
    | lengths | code points in both (VF-006) | This is JSON Schema `maxLength` semantics. JS measures with `[...text].length`, F# with `EnumerateRunes`. |
    | padded or case-variant product | **refuse** (no trim) | VIT-DOM-004 says names are never silently remapped. v1 transport takes exact display names; aliases resolve only through the registry. |

    Bidi marks, embeddings, overrides and isolates, C1 controls and lone surrogates are
    refused anywhere. Accepted text is trimmed and NFC-normalised, so canonically equivalent
    input normalises identically. The payload hash itself is intake's responsibility. The
    `sk-` credential pattern has a left word boundary, so "task-…", "desk-…" are no longer
    refused (D-06). JSON Schema patterns carry no flags, so case-insensitivity is spelled out
    as character classes. `\s`, `\S` and `\b` are avoided because their meaning differs
    between JS, ajv and .NET.
13. **v1 defect schema gains `reopened`, `expected-behavior`, `declined` and `superseded`**
    (VF-012). This change is additive only: every record valid before stays valid, and the
    v1 `schemaVersion` is unchanged. Why: the operator CLI and any v1 reader may still see v1
    records that this lifecycle has moved into those states. Making them unrepresentable
    would force a lossy write or a silent rejection. Retargeting the test to v2 would hide
    that. v2 remains the target shape. Impact labels map to codes through the single
    `impactCodes` export, and `domain-records.mjs` migration uses it as well.
14. **`resolved → closed` needs `verification-run` or `decision-record` evidence** (VF-015).
    Closing is a policy guard: the closure must point at the verification it relies on or
    at the decision that closes it. Table version 1.1.0.
15. **History is owned by the record** (VF-016). A record's non-creation events must equal
    its revision, otherwise the record is refused with `inconsistent_history`. Events are
    deep-copied and frozen when they are taken in, so an alias held by the caller cannot
    rewrite them. F# records and lists are immutable, and the F# core applies the same
    count guard to persisted (`Event.Recorded`) history.
16. **`occurredAt` must be a real ISO-8601 instant** (VF-017). That means a full date-time
    with seconds and an explicit `Z` or `±hh:mm` offset, every component in range
    (Gregorian leap years), and no trailing text. JS uses `isInstant` and F# uses
    `Instant.isValid`, with the same pattern and range rules.
17. **Legacy `classification` flag.** The legacy triage API (`triage-cli.mjs`) passes
    `classification` on every command. It is applied only where the table declares it,
    which matches the baseline semantics. The strict API still refuses undeclared fields.

### Round 2: bidirectional verification cycle (2026-10-08, still proposed; table 1.2.0)

Sources: `docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md` ("Bidirectional defect
state and verification cycle"), VIT-LCY-010/011 and VIT-VER-009 (P0), groundwork for
LCY-012/013 and VER-010/011, VIT-AC-033/034/036, and mission section 7. Kevin's
`tests/triage.test.mjs` and `tests/state-contract.test.mjs` are user-authored authority;
they pass unedited.

18. **Verification attempts are table data.** An edge may carry `attempt`:
    - `submission` (`in-progress → awaiting-verification`): requires `attemptId`,
      `candidateRevision` and `verification-request` evidence. Optional fields are `author`
      and `workItemId`.
    - `result` (`awaiting-verification → in-progress` with outcome `failed`, or `→ resolved`
      with outcome `passed`): requires `verification-run` evidence and the verifier or
      administrator role. It must name the **latest** submission's `attemptId` and
      `candidateRevision` (`attempt_mismatch`, with the message "…submitted candidate").
      A stated `verificationOutcome` must match the target (`outcome_mismatch`, "…outcome…").
      The outcome is recorded on the event.
    - `rework` (new edge `reopened → in-progress`): requires `attemptId` and `workItemId`
      ("new work attempt").

    An `attemptId` can be submitted only once per defect (`duplicate_attempt`). A record
    with no submission in its history has nothing to match, so the attempt fields are
    optional for it. This covers records that entered awaiting-verification before table
    1.2 and migrated records. Every passing, failing and inconclusive event stays in the
    append-only history with its attempt, candidate, verifier and evidence. A regression
    never rewrites earlier passing evidence.
19. **`verificationOutcome` ∈ {passed, failed, inconclusive}. Inconclusive is an event,
    not a self-loop** (VER-010). `recordInconclusive` appends a `type: "verification"`
    event against the latest submission. The defect stays `awaiting-verification`, and
    another run of the same attempt is still possible. Inconclusive never counts as a
    failure. It cannot resolve, cannot fail and cannot reopen: `inconclusive` on any
    result edge is refused as `outcome_mismatch`. I chose an event over a self-loop
    because a self-loop would make "awaiting-verification → awaiting-verification" a legal
    transition. That would let every UI and API treat it as a state change and would
    weaken the exhaustive edge matrix.
20. **Bounded agent repair** (VER-011, mission section 7). `agentRepairBudget(table,
    history, maxFailedAttempts)` is a pure function. It counts `failed` results since the
    last `reopened` transition or `escalation` event (the "open cycle").
    `maxFailedAttempts` is an explicit parameter. Its default is read from
    `policy.maxAutonomousFailedAttempts`, which is **3, `provisional: true`**. That value is
    a reversible engineering placeholder, not a decided limit; the owner decision is
    pending (VIT-OQ-012 / VER-011). Once the budget is reached, a submission by an actor
    with provenance `agent` is refused with `escalation_required`. Humans are not bound by
    it. `recordEscalation` may be called only by `authenticated-human` provenance in
    triager or administrator role. It appends an `escalation` event, which opens a new
    budget. The table loader refuses a budget that is not marked provisional.
21. **Independent verification** (VER-006, VIT-AC-036). A submission records `author`.
    The strict API defaults it to the submitting actor. A `passed` result recorded by
    that same actor is refused with `independence_required`
    (`policy.independentVerification`: required, appliesTo `[passed]`, provisional).
    **Change forced by Kevin's tests:** the legacy call shape never names an author, and
    Kevin's tests submit and verify as the same `operator-1`. The legacy adapter therefore
    records `author` only when the caller supplies it. For legacy callers, independence
    is enforced through the verifier role, as before. The strict API applies the full
    rule. To get author-level independence, the operator CLI should pass `author` (or move
    to the strict shape); this is a handoff.
22. **"Reopen and resume" composite** (LCY-011). `reopenAndResume(table, record, reopen,
    resume)` evaluates `→ reopened` and then `→ in-progress | reproducing` through every
    guard and returns both events, or neither (all-or-nothing). The reopened state is
    never skipped. On failure, `detail.step = "resume"` names the step that refused.
23. **Changes forced by Kevin's tests, each reconciled with typed evidence:**
    - `in-progress → awaiting-verification` now requires the attempt, the candidate
      revision and a verification request. A legacy `evidenceId` maps to
      `verification-request`.
    - `awaiting-verification → in-progress` is now verifier/administrator only and needs
      failure evidence. Triager was allowed before; this is stricter and consistent with
      VIT-LCY-010. A legacy `evidenceId` maps to `verification-run`.
    - `→ reopened` messages now mention "recurrence evidence". The legacy `evidenceId`
      maps to `new-occurrence` (the first kind the table lists). `affectedRelease` is
      recorded but **optional**, because Kevin's reopen test with only `evidenceId` +
      `affectedRelease` passes either way, and the adversarial reopen test (which sends no
      release) must still pass. Making it mandatory is left to Ordo/owner review.
    - Legacy events keep their field values at the top level as well (`attemptId`,
      `candidateRevision`, `verificationOutcome`, `affectedRelease`, `workItemId`,
      `evidenceId`), as Kevin's assertions on `history[n].field` require. Strict events
      keep them under `fields`. History readers accept both shapes (`verificationCycle`,
      F# `Event.field`).
    - `schemas/defect.schema.json` state enum is now exactly the table's defect states.
      A duplicated `reopened` from the merge was removed (state-contract test).
24. **VF-011.** The service also bounds the **stored** page URL. After sanitising
    (percent-encoding), the URL must still be ≤ 2000 characters, in JS and F#. JSON Schema
    cannot express "length after encoding", so this is the one documented schema/runtime
    gap. `report-cases.v1.json` records it on its case (`schemaExpect`, `schemaGap`), and
    `tests/domain-report-contract.test.mjs` fails if any undocumented gap appears.

### Round 3: identity and trust in the verification cycle (2026-10-08, still proposed; table 1.3.0)

The findings VF-025 to VF-028 come from the verification agent's round-3 review
(`docs/verification/EVIDENCE-APPRAISAL.md`, `tests/adversarial/verification-cycle.test.mjs`).

25. **The author of an attempt is the submitter** (VF-025). The submission event always
    records `author` = the submitting actor. A caller-supplied `author` is accepted only when
    it canonically equals that actor; otherwise the submission is refused with
    `author_mismatch`. Even a matching variant is recorded using the actor's own spelling.
    There is no delegation event. That is the minimal safe rule, and delegation can be added
    later as an explicit, authorized event if an owner needs it. Independence compares a
    passing verifier against the recorded author, falling back to the submitting event's
    actor, so a caller can no longer self-pass by naming a fictional author.

    **Legacy shape (Kevin's tests):** with provenance `unrecorded`, the author is still
    recorded as the actor, but the author-independence check is not applied. Independence
    for that path rests on the verifier role, as in section 21. Kevin's tests submit and
    verify as the same `operator-1`, and they pass unedited. A caller-supplied author can
    never enable a self-pass on any path, because the author is always the actor.
26. **Canonical actor identity** (VF-026). Every comparison of two actor identities uses
    `canonicalActor` = Unicode NFKC, trimmed, lower-cased (F#: `ActorId.canonical` /
    `ActorId.sameAs`, using invariant lower-casing). That covers both the author check and
    independence. Recorded values keep the supplied spelling. Actor ids are ASCII-only
    (the ActorId pattern), so compatibility-form ids such as full-width letters are refused
    (`missing_actor`) before any comparison. NFKC is applied anyway, for comparisons against
    recorded free text. The real fix is a Fides principal id; until Fides is qualified, this
    is the canonical string form.
27. **Provenance comes from the trusted caller boundary** (VF-027, mission section 7,
    gate 4).
    - The lifecycle API takes a **trusted context** argument:
      `evaluateTransition(table, record, command, { context: { provenance } })`, and the same
      for `recordInconclusive`, `recordEscalation` and `reopenAndResume`. F# uses
      `Actor.Trusted` and `Wire.decodeActorWith context`.
    - The context is supplied by the authenticated boundary: `triage-cli.mjs` passes its
      IAM-authenticated operator context (the one call site I edited, with the coordinator's
      grant), and the machine core will pass its verified principal's class.
    - A command-body provenance that disagrees with the context is refused
      (`provenance_conflict`).
    - **Fail closed:** without a trusted `authenticated-human` context, every submission is
      treated as autonomous for the repair budget. That includes the legacy shape
      (`unrecorded`), an omitted context, and a body that merely asserts
      `authenticated-human`. Once the budget is exhausted, `escalation_required` applies
      until a human records an escalation.
    - The strict API still requires *some* provenance (in the context or the body), so an
      omitted provenance with no context is `invalid_provenance`.
28. **A passing result requires an authenticated-human verifier** (VF-028; integrator
    decision; **provisional and reversible pending VIT-OQ-012**). The table records it as
    `policy.passRequiresHumanVerifier: true`.
    - Actors with provenance `agent`, `application` or `ci` may record `failed` and
      `inconclusive` results, but not `passed` (`human_verifier_required`).
    - The legacy shape (`unrecorded`) is still allowed to pass, because Kevin's authority
      tests use it. It has no production caller: `triage-cli` uses the strict path with a
      trusted human context.
    - Revisiting this requires an Ordo/owner decision on "qualified verification
      process" (OPEN-DECISIONS VIT-OQ-012).

    **Mutation-anchor note for the verification agent:** the appraisal's V05 anchor (the
    old exact-string author comparison) no longer exists, because VF-026 had to replace it
    with the canonical comparison. Its replacement is
    `... && author && sameActor(author, command.actor)) {` in `checkAttempt`. V04 still
    resolves.

## Alternatives considered

- **Keep the graph in code (status quo).** Rejected: JS, F# and any UI would drift
  (VIT-LCY-001 requires the same model everywhere).
- **Use Ordo's `TransitionRequirement`/`TransitionAuthorization` directly.** Deferred.
  Ordo is not installed or qualified for Vitium (Conditor #5), it is a .NET library that
  JS cannot run, and its authorization token must not be forged. When Ordo is adopted, the
  table should map onto `TransitionRequirement`s (state precondition, capabilities ≈ roles,
  evidence requirements) and Ordo's evaluator should replace `Lifecycle.authorize`.
- **Mutate the observation into a defect on promotion.** Rejected by VIT-LCY-002: it
  destroys the observation identity and lets untrusted input become a defect.
- **Model fix facts as states** (e.g. `merged`, `deployed`). Rejected by VIT-VER-005:
  these are independent facts that may arrive in any order or not at all.
- **Map unknown product names to "Other / not sure".** Rejected by VIT-DOM-004 ("never
  silently assigned").
- **Add a JSON Schema validator dependency (ajv).** Not done: dependencies are kept
  minimal. Tests use a strict subset validator that fails on any keyword it does not implement.

## Consequences and semantic changes

- `service/triage.mjs` behaviour change: **reopening now requires `new-occurrence` or
  `triage-correction` evidence.** Before, a reason alone was enough. `tests/triage.test.mjs`
  was updated to assert the refusal and then supply evidence. For the legacy call shape,
  a single `evidenceId` is recorded as the kind the edge requires, flagged
  `legacyEvidence: true`.
- New legal edges (dispositions, reopen from new dispositions) exist only as candidates.
- Refusals carry stable codes (`forbidden_transition`, `unauthorized_role`,
  `missing_evidence`, `stale_revision`, ...), and `TransitionError.code` exposes them to callers.
- `service/triage.mjs` imports `../schemas/...`. This is fine for the repository-local
  operator CLI. The Lambda candidate (CodeUri `service/`) never imports `triage.mjs`.

## Verification

- `npm test`: the exhaustive (from,to) matrix over both machines, the shared cases,
  AC-011/AC-012 scenarios, promotion, facts, registry divergence, schema conformance and
  real-fixture migration.
- `dotnet run --project domain/Vitium.Domain.Tests`: the same shared cases, the same matrix,
  and table-data mutants.
- Code mutants of both implementations (role, evidence, revision, required-field/self-reference,
  forbidden-edge, reopen link) were each observed to fail the suites. Evidence is in the
  integrator's mission record.

## Pending authority

Before this can become `accepted`: an Ordo review of states, guards, roles and evidence
kinds; resolution of VIT-OQ-002 (canonical record owner), VIT-OQ-011 (canonical states)
and VIT-OQ-012 (who may verify); and a Conditor-qualified Ordo installation whose contract
the table is checked against.
