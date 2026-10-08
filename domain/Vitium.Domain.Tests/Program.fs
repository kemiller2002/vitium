/// Console test runner for the Vitium F# domain core. No test framework (NuGet is
/// unavailable): plain assertion helpers; exit code 1 when any test fails.
module Vitium.Domain.Tests.Program

open System
open System.IO
open System.Text.Json
open Vitium.Domain

// ---------------------------------------------------------------- harness

type Outcome =
    | Passed
    | Failed of string

exception AssertionFailed of string

let fail message = raise (AssertionFailed message)
let isTrue message condition = if not condition then fail message
let equal message (expected: 'a) (actual: 'a) =
    if expected <> actual then fail (sprintf "%s: expected %A, got %A" message expected actual)

let okValue message result =
    match result with
    | Ok v -> v
    | Error e -> fail (sprintf "%s: expected Ok, got Error %A" message e)

let errorValue message result =
    match result with
    | Error e -> e
    | Ok v -> fail (sprintf "%s: expected Error, got Ok %A" message v)

let run (name: string, body: unit -> unit) =
    try
        body ()
        name, Passed
    with
    | AssertionFailed m -> name, Failed m
    | ex -> name, Failed("unexpected exception: " + ex.ToString())

// ---------------------------------------------------------------- inputs

/// Repository root: walk up from the current directory until schemas/ exists.
let repoRoot =
    let rec up (dir: DirectoryInfo) =
        if isNull dir then failwith "repository root (schemas/) not found"
        elif Directory.Exists(Path.Combine(dir.FullName, "schemas", "lifecycle")) then dir.FullName
        else up dir.Parent

    match Environment.GetEnvironmentVariable "VITIUM_REPO_ROOT" with
    | null
    | "" -> up (DirectoryInfo(Directory.GetCurrentDirectory()))
    | root -> root

let readText (relative: string) = File.ReadAllText(Path.Combine(repoRoot, relative))
let tableJson = readText "schemas/lifecycle/transitions.v1.json"
let registryJson = readText "schemas/products.v1.json"
let table = Table.parse tableJson |> okValue "load transitions.v1.json"
let registry = Registry.parse registryJson |> okValue "load products.v1.json"

let at = DateTimeOffset.Parse "2026-10-08T12:00:00Z"
let unwrap r = okValue "identity" r

let actor role =
    { Id = ActorId.create "operator-1" |> unwrap
      Provenance = Provenance.AuthenticatedHuman
      Role = role }

let triager = actor "triager"
let verifier = actor "verifier"
let evidence kind reference = { Kind = kind; Ref = EvidenceRef.create reference |> unwrap }

let command target =
    { To = target
      ExpectedRevision = 0
      Reason = "Independent investigation"
      Fields = Map.empty
      Evidence = []
      OccurredAt = at }

let defectId text = DefectId.create text |> unwrap

let record machine state =
    { Lifecycle.initial table machine None with State = state }

let defect state = { record Machine.Defect state with Identity = Some(RecordIdentity.Defect(defectId "DEF-0002")) }

let codeOf r = r |> errorValue "expected refusal" |> TransitionError.code

// ---------------------------------------------------------------- mutation hooks
//
// Mutation sensitivity is proven by running the SAME tests against deliberately
// weakened copies of the transition table (data mutants). If a guard's test still
// passed against its mutant, the test would not be protecting that guard.

/// Typed navigation over a mutable JSON DOM (test-only; production code is immutable).
let node (root: Nodes.JsonNode) (path: string list) : Nodes.JsonNode =
    path |> List.fold (fun (n: Nodes.JsonNode) (key: string) ->
        match Int32.TryParse key with
        | true, i -> n.AsArray().[i]
        | _ -> n.AsObject().[key]) root

let set (target: Nodes.JsonNode) (key: string) (value: Nodes.JsonNode) = target.AsObject().[key] <- value
let strings (values: string list) = Nodes.JsonArray(values |> List.map (fun v -> Nodes.JsonValue.Create(v) :> Nodes.JsonNode) |> Array.ofList)

let mutateTable (edit: Nodes.JsonNode -> unit) =
    let node = Nodes.JsonNode.Parse tableJson
    edit node
    Table.parse (node.ToJsonString()) |> okValue "mutant table must still parse"

let transitionNode (root: Nodes.JsonNode) machine from target =
    (node root [ "machines"; machine; "transitions" ]).AsArray()
    |> Seq.find (fun t -> (node t [ "from" ]).GetValue<string>() = from && (node t [ "to" ]).GetValue<string>() = target)

// ---------------------------------------------------------------- guard tests (parameterised by table)

let guardResolveNeedsVerifier (t: Table) =
    let r = Lifecycle.transition t triager { command "resolved" with Evidence = [ evidence "verification-run" "run-1" ] } (defect "awaiting-verification")
    equal "triager cannot resolve" "unauthorized_role" (codeOf r)

let guardDuplicateNeedsDuplicateOf (t: Table) =
    let r = Lifecycle.transition t triager (command "duplicate") (defect "triaged")
    equal "duplicate without duplicateOf" "missing_field" (codeOf r)

let guardConfirmNeedsReproduction (t: Table) =
    let r = Lifecycle.transition t triager (command "confirmed") (defect "triaged")
    equal "confirm without reproduction" "missing_evidence" (codeOf r)

let guardReopenNeedsEvidence (t: Table) =
    let r = Lifecycle.transition t triager (command "reopened") (defect "closed")
    equal "reopen without evidence" "missing_evidence" (codeOf r)

let guardForbiddenEdge (t: Table) =
    let r = Lifecycle.transition t triager (command "in-progress") (defect "duplicate")
    equal "duplicate -> in-progress" "forbidden_transition" (codeOf r)

let mutants: (string * (Table -> unit) * (Nodes.JsonNode -> unit)) list =
    [ "resolve role guard",
      guardResolveNeedsVerifier,
      (fun root -> set (transitionNode root "defect" "awaiting-verification" "resolved") "roles" (strings [ "triager"; "verifier" ]))
      "duplicateOf required-field guard",
      guardDuplicateNeedsDuplicateOf,
      (fun root ->
          let t = transitionNode root "defect" "triaged" "duplicate"
          set t "requiredFields" (strings [])
          set t "optionalFields" (strings [ "duplicateOf" ]))
      "reproduction evidence guard",
      guardConfirmNeedsReproduction,
      (fun root -> set (transitionNode root "defect" "triaged" "confirmed") "evidenceAnyOf" (strings []))
      "reopen evidence guard",
      guardReopenNeedsEvidence,
      (fun root -> set (transitionNode root "defect" "closed" "reopened") "evidenceAnyOf" (strings []))
      "forbidden edge (fail closed)",
      guardForbiddenEdge,
      (fun root ->
          let arr = (node root [ "machines"; "defect"; "transitions" ]).AsArray()
          let extra = (transitionNode root "defect" "confirmed" "in-progress").DeepClone()
          set extra "from" (Nodes.JsonValue.Create("duplicate"))
          arr.Add extra) ]

// ---------------------------------------------------------------- tests

let tests: (string * (unit -> unit)) list =
    [ "table loads as candidate authority and refuses an Ordo claim",
      fun () ->
          let claim = Nodes.JsonNode.Parse tableJson
          set claim "ordoAuthorized" (Nodes.JsonValue.Create(true))
          Table.parse (claim.ToJsonString()) |> errorValue "ordo claim" |> ignore
          let dup = Nodes.JsonNode.Parse tableJson
          let arr = (node dup [ "machines"; "defect"; "transitions" ]).AsArray()
          arr.Add(arr.[0].DeepClone())
          Table.parse (dup.ToJsonString()) |> errorValue "duplicate pair" |> ignore
          Table.parse "{not json" |> errorValue "malformed" |> ignore

      "shared transition-cases.v1.json: F# agrees with JS on every case",
      fun () ->
          use doc = JsonDocument.Parse(readText "schemas/lifecycle/transition-cases.v1.json")
          let cases = doc.RootElement.GetProperty("cases").EnumerateArray() |> List.ofSeq
          isTrue "at least 40 shared cases" (cases.Length >= 40)

          for c in cases do
              let name = c.GetProperty("name").GetString()
              let expect = c.GetProperty "expect"
              let r = Wire.evaluate table (c.GetProperty "record") (c.GetProperty "command")

              if expect.GetProperty("ok").GetBoolean() then
                  let next, _ = okValue name r
                  equal (name + " state") (expect.GetProperty("state").GetString()) next.State
                  equal (name + " revision") (expect.GetProperty("revision").GetInt32()) next.Revision
                  equal (name + " history") 1 next.History.Length
              else
                  match r with
                  | Ok _ -> fail (name + ": expected refusal")
                  | Error e -> equal name (expect.GetProperty("code").GetString()) (TransitionError.code e)

      "exhaustive matrix: exactly the table's (from,to) pairs are legal",
      fun () ->
          let allStates =
              (table.Definition Machine.Observation).States @ (table.Definition Machine.Defect).States @ [ "unknown" ]

          let fieldValue =
              Map.ofList [ "classification", "suspected defect"; "duplicateOf", "DEF-0001"; "supersededBy", "DEF-0003"; "workItemRef", "w-1" ]

          let allEvidence =
              table.EvidenceKinds |> Map.toList |> List.map fst |> List.filter ((<>) "unspecified") |> List.map (fun k -> evidence k ("ev-" + k))

          let mutable legal = 0

          for machine in [ Machine.Observation; Machine.Defect ] do
              let def = table.Definition machine
              let pairs = Set.ofList (Table.legalPairs table machine)

              for from in def.States do
                  for target in allStates do
                      let rule = def.Transitions |> List.tryFind (fun t -> t.From = from && t.To = target)
                      let role = rule |> Option.map (fun r -> r.Roles.Head) |> Option.defaultValue "administrator"

                      let fields =
                          rule |> Option.map (fun r -> r.RequiredFields |> List.map (fun f -> f, fieldValue[f]) |> Map.ofList) |> Option.defaultValue Map.empty

                      let r =
                          Lifecycle.transition table (actor role) { command target with Fields = fields; Evidence = allEvidence } (defect from |> fun d -> { d with Machine = machine })

                      if pairs.Contains(from, target) then
                          let next, _ = okValue (sprintf "%A %s->%s" machine from target) r
                          equal "state" target next.State
                          equal "machine unchanged" machine next.Machine
                          legal <- legal + 1
                      else
                          equal (sprintf "%A %s->%s" machine from target) "forbidden_transition" (codeOf r)

          equal "legal pair count" 40 legal

      "illegal transitions are refused",
      fun () ->
          equal "observation -> confirmed" "forbidden_transition" (codeOf (Lifecycle.transition table triager (command "confirmed") (record Machine.Observation "received")))
          equal "resolved -> new" "forbidden_transition" (codeOf (Lifecycle.transition table triager (command "new") (defect "resolved")))
          equal "unknown source" "unknown_state" (codeOf (Lifecycle.transition table triager (command "closed") (defect "fixed")))

      "missing reason and missing evidence are refused",
      fun () ->
          equal "blank reason" "missing_reason" (codeOf (Lifecycle.transition table triager { command "triaged" with Reason = "  " } (defect "new")))
          equal "long reason" "reason_too_long" (codeOf (Lifecycle.transition table triager { command "triaged" with Reason = String('x', 1001) } (defect "new")))
          guardConfirmNeedsReproduction table
          let wrongKind = Lifecycle.transition table verifier { command "resolved" with Evidence = [ evidence "supporting" "s" ] } (defect "awaiting-verification")
          equal "wrong evidence kind" "missing_evidence" (codeOf wrongKind)
          let unspecified = Lifecycle.transition table triager { command "confirmed" with Evidence = [ evidence "unspecified" "legacy" ] } (defect "triaged")
          equal "untyped legacy evidence" "missing_evidence" (codeOf unspecified)

      "stale revision is refused",
      fun () ->
          let r = Lifecycle.transition table triager { command "triaged" with ExpectedRevision = 1 } { defect "new" with Revision = 2 }
          equal "stale" "stale_revision" (codeOf r)

      "duplicate requires duplicateOf, which cannot be itself",
      fun () ->
          guardDuplicateNeedsDuplicateOf table
          let self = Lifecycle.transition table triager { command "duplicate" with Fields = Map [ "duplicateOf", "DEF-0002" ] } (defect "triaged")
          equal "self" "self_reference" (codeOf self)
          let bad = Lifecycle.transition table triager { command "duplicate" with Fields = Map [ "duplicateOf", "#12" ] } (defect "triaged")
          equal "github number is not a defect id" "invalid_field" (codeOf bad)
          let next, _ = Lifecycle.transition table triager { command "duplicate" with Fields = Map [ "duplicateOf", "DEF-0001" ] } (defect "triaged") |> okValue "dup"
          isTrue "duplicateOf is not a triage judgement" (not (next.Triage.ContainsKey "duplicateOf"))

      "reopen preserves prior closure evidence and history",
      fun () ->
          let closed, closing =
              Lifecycle.transition table triager { command "duplicate" with Fields = Map [ "duplicateOf", "DEF-0001" ]; Evidence = [ evidence "supporting" "fingerprint" ] } (defect "triaged")
              |> okValue "close as duplicate"

          guardReopenNeedsEvidence table

          let reopened, event =
              Lifecycle.transition table triager { command "reopened" with ExpectedRevision = 1; Evidence = [ evidence "triage-correction" "analysis-3" ] } closed
              |> okValue "reopen"

          equal "history length" 2 reopened.History.Length
          equal "closure event retained" closing reopened.History.Head

          match event with
          | Event.Transitioned t ->
              equal "reopens" (Some { Sequence = 1; State = "duplicate"; Evidence = [ evidence "supporting" "fingerprint" ] }) t.Reopens
          | other -> fail (sprintf "unexpected event %A" other)

      "wrong role and wrong provenance are refused",
      fun () ->
          guardResolveNeedsVerifier table
          equal "reporter" "unauthorized_role" (codeOf (Lifecycle.transition table (actor "reporter") (command "triaged") (defect "new")))
          let anonymous = { triager with Provenance = Provenance.AnonymousHuman }
          equal "anonymous cannot triage" "invalid_provenance" (codeOf (Lifecycle.transition table anonymous (command "triaged") (defect "new")))
          let ok, _ = Lifecycle.transition table verifier { command "resolved" with Evidence = [ evidence "verification-run" "run-1" ] } (defect "awaiting-verification") |> okValue "verifier"
          equal "resolved" "resolved" ok.State

      "triage judgements are independent and never inferred",
      fun () ->
          let obs = record Machine.Observation "accepted-for-triage"
          let fields = Map [ "classification", "suspected defect"; "severity", "low"; "priority", "urgent" ]
          let next, _ = Lifecycle.transition table triager { command "classified" with Fields = fields } obs |> okValue "classify"
          let assessment = TriageAssessment.ofLifecycle next
          equal "severity" (Some Severity.Low) assessment.Severity
          equal "priority" (Some Priority.Urgent) assessment.Priority
          equal "confidence not inferred" None assessment.Confidence
          equal "classification required" "missing_field" (codeOf (Lifecycle.transition table triager (command "classified") obs))
          equal "severity vocabulary" "invalid_field" (codeOf (Lifecycle.transition table triager { command "classified" with Fields = Map [ "classification", "x"; "severity", "P0" ] } obs))

      "promotion creates a new defect identity and never mutates the observation into one",
      fun () ->
          let obsId = ObservationId.create ("OBS-" + String('a', 32)) |> unwrap
          let obs = { Lifecycle.initial table Machine.Observation (Some(RecordIdentity.Observation obsId)) with State = "classified"; Revision = 2 }
          let cmd = { ExpectedRevision = 2; NewDefect = defectId "DEF-0042"; Reason = "Reproducible"; OccurredAt = at }
          let updated, created, _ = Lifecycle.promote table triager cmd obs |> okValue "promote"
          equal "observation stays observation" Machine.Observation updated.Machine
          equal "observation state unchanged" "classified" updated.State
          equal "observation identity unchanged" obs.Identity updated.Identity
          equal "link" [ defectId "DEF-0042" ] updated.LinkedDefects
          equal "new defect machine" Machine.Defect created.Machine
          equal "new defect state" "new" created.State
          equal "new defect identity" (Some(RecordIdentity.Defect(defectId "DEF-0042"))) created.Identity
          equal "unclassified cannot be promoted" "forbidden_transition" (codeOf (Lifecycle.promote table triager cmd { obs with State = "accepted-for-triage" } |> Result.map (fun (a, _, e) -> a, e)))
          equal "verifier cannot promote" "unauthorized_role" (codeOf (Lifecycle.promote table verifier cmd obs |> Result.map (fun (a, _, e) -> a, e)))
          equal "stale" "stale_revision" (codeOf (Lifecycle.promote table triager { cmd with ExpectedRevision = 1 } obs |> Result.map (fun (a, _, e) -> a, e)))
          equal "twice" "invalid_defect_id" (codeOf (Lifecycle.promote table triager { cmd with ExpectedRevision = 3 } updated |> Result.map (fun (a, _, e) -> a, e)))

      "fix facts are events and never change state",
      fun () ->
          let d = { defect "in-progress" with Revision = 3 }
          let next, _ = Lifecycle.recordFact table triager { Fact = "code-merged"; ExpectedRevision = 3; Evidence = [ evidence "supporting" "commit" ]; OccurredAt = at } d |> okValue "fact"
          equal "state unchanged" "in-progress" next.State
          equal "revision" 4 next.Revision
          equal "unknown fact" "unknown_fact" (codeOf (Lifecycle.recordFact table triager { Fact = "deployed"; ExpectedRevision = 3; Evidence = []; OccurredAt = at } d))
          equal "verified needs verifier" "unauthorized_role" (codeOf (Lifecycle.recordFact table triager { Fact = "verified-resolved"; ExpectedRevision = 3; Evidence = [ evidence "verification-run" "r" ]; OccurredAt = at } d))

      "registry: alias resolution, unknown product refused, explicit unknown accepted",
      fun () ->
          let r = Registry.resolveProduct registry "State Directed Engineering" |> okValue "alias"
          equal "alias id" "ordo" (ProductId.value r.Product.Id)
          isTrue "alias flagged" r.MatchedAlias
          equal "normalised" "forma-studio" (Registry.resolveProduct registry "  forma   STUDIO " |> okValue "ws" |> fun p -> ProductId.value p.Product.Id)
          equal "nfkc" "ordo" (Registry.resolveProduct registry "ｓｄｅ" |> okValue "nfkc" |> fun p -> ProductId.value p.Product.Id)

          for bad in [ "Formaa"; "Forma Studio Pro"; "Github"; String('x', 101) ] do
              match Registry.resolveProduct registry bad with
              | Error(RegistryError.UnsupportedProduct _) -> ()
              | other -> fail (sprintf "%s should be refused, got %A" bad other)

          equal "blank" (Error RegistryError.ProductRequired) (Registry.resolveProduct registry "  ")
          let unknown = Registry.resolveProduct registry "Other / not sure" |> okValue "unknown"
          isTrue "explicit unknown" unknown.Product.IsUnknown

      "registry: same display names as the JS registry, fails closed on ambiguity",
      fun () ->
          let names = registry.Products |> List.map (fun p -> p.DisplayName)
          use doc = JsonDocument.Parse registryJson
          let expected = doc.RootElement.GetProperty("products").EnumerateArray() |> Seq.map (fun p -> p.GetProperty("displayName").GetString()) |> List.ofSeq
          equal "names" expected names
          let clash = Nodes.JsonNode.Parse registryJson
          set (node clash [ "products"; "0" ]) "aliases" (strings [ "Forma" ])
          Registry.parse (clash.ToJsonString()) |> errorValue "ambiguous alias" |> ignore

      "identities are distinct types with smart constructors",
      fun () ->
          ExternalReference.create "VIT-0001" |> errorValue "legacy id is not a reference" |> ignore
          ExternalReference.create "#12" |> errorValue "github number" |> ignore
          DefectId.create ("VIT-" + String('A', 32)) |> errorValue "reference is not a defect id" |> ignore
          ObservationId.create "DEF-0001" |> errorValue "defect id is not an observation id" |> ignore
          ActorId.create "Jane Doe" |> errorValue "display name is not an actor id" |> ignore
          ActorId.create "arn:aws:iam::123456789012:user/operator" |> okValue "iam arn" |> ignore
          WorkItemRef.create "GitHub" "x" |> errorValue "system id is lower-case" |> ignore
          equal "work item" "github" (WorkItemRef.create "github" "https://example.com/1" |> okValue "wi" |> WorkItemRef.system)

      "report normalisation is deterministic and typed",
      fun () ->
          let raw =
              { SchemaVersion = "1.0"
                Product = " Forma "
                Impact = "Not sure"
                Title = " Cannot save "
                Actual = "Save does nothing."
                Expected = "Saved."
                Steps = Some "Open.\nSave."
                PageUrl = Some "https://user:pw@example.com/path?token=secret#frag"
                PrivacyAcknowledged = true }

          let a = Report.normalise registry raw |> okValue "normalise"
          let b = Report.normalise registry raw |> okValue "normalise again"
          equal "deterministic" a b
          equal "url stripped" "https://example.com/path" a.PageUrl
          equal "trimmed" "Cannot save" a.Title
          equal "impact" ReportedImpact.Unknown a.ReportedImpact
          equal "version" (Error(ReportError.UnsupportedVersion "2.0")) (Report.normalise registry { raw with SchemaVersion = "2.0" })
          equal "privacy" (Error ReportError.PrivacyNotAcknowledged) (Report.normalise registry { raw with PrivacyAcknowledged = false })
          equal "too long" (Error(ReportError.TooLong("summary", 120))) (Report.normalise registry { raw with Title = String('x', 121) })
          equal "non-http" (Error ReportError.NonHttpPageUrl) (Report.normalise registry { raw with PageUrl = Some "javascript:alert(1)" })
          equal "credential" (Error ReportError.CredentialDetected) (Report.normalise registry { raw with Actual = "password: hunter22" })

          match Report.normalise registry { raw with Product = "Formaa" } with
          | Error(ReportError.Product(RegistryError.UnsupportedProduct _)) -> ()
          | other -> fail (sprintf "unknown product must be refused, got %A" other)

      "observation creation uses injected effects only",
      fun () ->
          let ports =
              { Now = fun () -> at
                NewReference = fun () -> ExternalReference.create ("VIT-" + String('A', 32)) |> unwrap
                NewObservationId = fun () -> ObservationId.create ("OBS-" + String('b', 32)) |> unwrap }

          let report =
              Report.normalise registry
                  { SchemaVersion = "1.0"; Product = "Forma"; Impact = "Not sure"; Title = "t"; Actual = "a"; Expected = "e"; Steps = None; PageUrl = None; PrivacyAcknowledged = true }
              |> okValue "report"

          let o = Observation.receive table ports { Channel = "public-api"; Provenance = Provenance.AnonymousHuman } report
          equal "initial state" "received" o.Lifecycle.State
          equal "time from port" at o.ReceivedAt
          isTrue "reference differs from internal id" (ExternalReference.value o.Reference <> ObservationId.value o.Id)

      "mutation sensitivity: each guard test FAILS against its weakened table",
      fun () ->
          for name, guardTest, mutate in mutants do
              // Original table: guard test passes.
              guardTest table
              // Mutant: the same guard test must fail, proving it detects the weakening.
              let mutant = mutateTable mutate

              let detected =
                  try
                      guardTest mutant
                      false
                  with AssertionFailed _ ->
                      true

              isTrue ("mutant not detected: " + name) detected ]

[<EntryPoint>]
let main _ =
    let results = tests |> List.map run

    for name, outcome in results do
        match outcome with
        | Passed -> printfn "ok      %s" name
        | Failed message -> printfn "FAILED  %s\n        %s" name message

    let failed = results |> List.filter (fun (_, o) -> o <> Passed) |> List.length
    printfn "\n%d tests, %d passed, %d failed (mutants checked: %d)" results.Length (results.Length - failed) failed mutants.Length
    if failed = 0 then 0 else 1
