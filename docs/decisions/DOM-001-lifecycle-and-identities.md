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
