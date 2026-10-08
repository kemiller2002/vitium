# Vitium F# domain core (candidate)

**Status:** proposed design (see [DOM-001](../docs/decisions/DOM-001-lifecycle-and-identities.md)).
The lifecycle model is a Vitium domain candidate. It is **not Ordo-authorized**.

This is the typed core for issue #8 (VIT-DOM-001..006, VIT-LCY-001..004). It is pure:
no clocks, randomness, storage or network. Effects come in as function parameters
(`ObservationPorts`). Nothing in it is specific to GitHub. GitHub appears only as a
`WorkItemRef` system name that an adapter picks.

## One model, two implementations

| Artifact | Role |
|---|---|
| `schemas/lifecycle/transitions.v1.json` | The **single** legal-transition table (states, roles, required fields, evidence kinds, promotion, fix facts). `authority: "vitium-domain-candidate"`, `ordoAuthorized: false`. |
| `schemas/lifecycle/transition-cases.v1.json` | Shared cases. Both the F# runner and `tests/domain-lifecycle-contract.test.mjs` must give the same `ok/state/revision` or the same error code. |
| `schemas/products.v1.json` | Canonical product registry with aliases and an explicit `unknown` entry. |
| `service/lifecycle.mjs`, `service/triage.mjs` | JS evaluation of the same table. |
| `domain/Vitium.Domain` | F# evaluation of the same table, parsed with `System.Text.Json`. |

Both implementations refuse any table that claims Ordo authority, has duplicate
`(from,to)` pairs, unknown states, roles, fields or evidence kinds, or a transition
without a required reason. Any pair the table does not list is forbidden (fail closed).

## Modules

- `Identity.fs`: single-case private DU identities with smart constructors:
  `ObservationId` (`OBS-<32 hex>`, internal), `ExternalReference` (`VIT-<32 HEX>`, an opaque
  receipt that is not tied to GitHub numbers), `DefectId` (`DEF-<n>`), `ProductId`, `ActorId`,
  `EvidenceRef`, `WorkItemRef`. Also the `Provenance` classes (anonymous-human,
  authenticated-human, application, ci, agent) and `Actor`.
- `Registry.fs`: registry parsing and validation, plus `resolveProduct`/`resolveImpact`.
  The alias key is NFKC + trim + collapse whitespace + lower-case, the same rule as in JS.
- `Report.fs`: `RawReport` → `Report`. Deterministic normalisation with typed `ReportError`.
  It refuses unsupported products and never remaps them.
- `Table.fs`: parses and checks `transitions.v1.json`.
- `Lifecycle.fs`: `transition : Table -> Actor -> TransitionCommand -> LifecycleRecord -> Result<LifecycleRecord * Event, TransitionError>`,
  plus `authorize`, `promote` (creates a **new** defect identity linked to the
  observation) and `recordFact` (fix facts are events, never states).
- `Wire.fs`: decodes the strict JSON command shape that the shared cases use.
- `Model.fs`: `Observation`, `Defect`, `TriageAssessment`. Severity, priority and
  confidence are separate optional values, and none of them is inferred from reported
  impact or from each other. `ObservationPorts` holds the effects.

## Building and testing offline

NuGet is unreachable here. The projects need only `FSharp.Core`, and the .NET SDK
ships it in `<sdk>/FSharp/library-packs`. `domain/nuget.config` clears every remote
feed and fallback folder. `Directory.Build.props` turns off the implicit fallback
folder. `obj/project.assets.json` then lists exactly one library (`FSharp.Core/8.0.403`)
and one source (the SDK library pack).

```bash
# .NET 8 SDK (8.0.425 was used), e.g. via dotnet-install.sh --channel 8.0
dotnet build domain/Vitium.Domain.Tests
dotnet run --project domain/Vitium.Domain.Tests   # exit code 1 on any failure
```

The runner finds the repository root by walking up to `schemas/lifecycle`. You can
override it with `VITIUM_REPO_ROOT`. It is a console app with plain assertion helpers
and no test framework. One of its tests checks mutation sensitivity: it re-runs the
role, required-field, evidence, reopen-evidence and forbidden-edge guard tests against
**weakened copies of the table**, and each one must fail.

`InvariantGlobalization` is off on purpose. With it on, .NET skips NFKC normalisation
of non-ASCII text, so the F# alias key would no longer match JS
`normalize("NFKC")`. The runner checks this with full-width `ｓｄｅ` → `ordo`.

## Alignment with Echelon libraries (naming only, no dependency)

Arca (`kemiller2002/arca` @ `0380fa6`, release 0.2.0) and Ordo (`kemiller2002/ordo` @
`869bc48`, v1.5.0) were cloned read-only so the names here could follow theirs.
Neither is a dependency. They are not Conditor-qualified for Vitium, Arca targets
`net10.0`, and NuGet is blocked.

| Vitium | Aligned with | Notes |
|---|---|---|
| `type ObservationId = private ObservationId of string` + `[<RequireQualifiedAccess>] module ObservationId = create / value` | Arca `RecordId`, `RecordType`, `IdempotencyKey` | Same private single-case DU + `create : string -> Result` + `value` pattern. |
| `ActorId` alphabet `A-Za-z0-9 . _ : / -` | Arca `ActorId` (`Manifest.fs`) | Vitium also allows `+ = , @` and up to 256 characters, because the provisional operator CLI uses IAM ARNs. Whitespace and display names are refused, as in Arca. |
| `Provenance` (anonymous-human, authenticated-human, application, ci, agent) | Arca `ActorKind` (Human, Agent, Service, Integration) | Vitium's classes come from VIT-DOM-005. A future Arca adapter maps `AnonymousHuman`/`AuthenticatedHuman` → `Human`, `Application`/`Ci` → `Service`/`Integration`, and `Agent` → `Agent`. |
| `ObservationPorts` (record of functions) | Arca `StorageProvider` (record of `Namespace -> ... -> Async<Result<_, StorageFailure>>`) | Effects are records of functions, not interfaces or classes. A storage port for observations/defects is deferred to the Arca integration (VIT-DOM-010, P1). |
| `LifecycleRecord.Revision` + `StaleRevision` | Arca `Revision`/`Concurrency.check` (Current/Stale), Ordo `TransitionFailure.StaleState` | Optimistic concurrency on an integer revision. |
| `TransitionError` (one case per remedy) | Ordo `TransitionFailure` (`InvalidState`, `MissingCapability`, `MissingEvidence`, `WrongEvidenceKind`, `StaleState`, ...) | Kept separate per cause, as Ordo does. Vitium does **not** produce an Ordo `TransitionAuthorization`; that needs the installed Ordo contract. |
| Schema versioning + explicit `migrate` | Arca `Record.SchemaVersion`, `MigrationPlan`/`RecordTransform` | `service/domain-records.mjs` migrates v1 → v2 and keeps the original under `migration.original`. |

## Not done here (explicitly)

- No Ordo authority claim and no use of an installed Ordo contract (pending Conditor install, #5).
- No persistence adapter. The F# core does not yet replay persisted history from JSON (`Wire.decodeRecord` refuses a non-empty history).
- No HTTP or Limen boundary. The JS intake service is still the runtime path. The F# core is the typed target that the JS model is checked against.
