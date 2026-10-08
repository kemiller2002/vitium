namespace Vitium.Domain

open System.Text.Json

/// The two lifecycle machines. Observations and defects never share a state.
[<RequireQualifiedAccess>]
type Machine =
    | Observation
    | Defect

[<RequireQualifiedAccess>]
module Machine =
    let toWire m =
        match m with
        | Machine.Observation -> "observation"
        | Machine.Defect -> "defect"

    let ofWire text =
        match text with
        | "observation" -> Some Machine.Observation
        | "defect" -> Some Machine.Defect
        | _ -> None

/// How a declared transition field is validated.
[<RequireQualifiedAccess>]
type FieldRule =
    | Text of maxLength: int
    | OneOf of values: string list
    | Matches of pattern: string

type TransitionRule =
    { From: string
      To: string
      Roles: string list
      RoleRationale: string option
      RequiredFields: string list
      OptionalFields: string list
      /// At least one evidence item of one of these kinds is required; empty = none.
      EvidenceAnyOf: string list }

type MachineDefinition =
    { States: string list
      Initial: string
      Terminal: string list
      Dispositions: string list
      Transitions: TransitionRule list }

type PromotionRule =
    { FromState: string
      ToState: string
      Roles: string list }

type FactRule = { Roles: string list; EvidenceAnyOf: string list }

/// The parsed, validated transition table (schemas/lifecycle/transitions.v1.json).
/// Only constructible through `Table.parse`, which fails closed.
[<NoComparison>]
type Table =
    private
        { TableVersion: string
          RoleList: string list
          CommandProvenanceList: Provenance list
          EvidenceKindLabels: Map<string, string>
          FieldRules: Map<string, FieldRule>
          ReasonLimit: int
          ObservationMachine: MachineDefinition
          DefectMachine: MachineDefinition
          PromotionRule: PromotionRule
          FactRules: Map<string, FactRule> }

    member this.Version = this.TableVersion
    member this.Roles = this.RoleList
    member this.CommandProvenances = this.CommandProvenanceList
    member this.EvidenceKinds = this.EvidenceKindLabels
    member this.Fields = this.FieldRules
    member this.ReasonMaxLength = this.ReasonLimit
    member this.Promotion = this.PromotionRule
    member this.Facts = this.FactRules

    member this.Definition machine =
        match machine with
        | Machine.Observation -> this.ObservationMachine
        | Machine.Defect -> this.DefectMachine

[<RequireQualifiedAccess>]
module Table =

    let private fieldRule (name: string, e: JsonElement) =
        result {
            let! kind = JsonRead.propWith "type" JsonRead.str e

            let! rule =
                match kind with
                | "text" ->
                    JsonRead.optPropWith "maxLength" JsonRead.int e
                    |> Result.map (fun m -> FieldRule.Text(Option.defaultValue 200 m))
                | "enum" -> JsonRead.propWith "values" JsonRead.strings e |> Result.map FieldRule.OneOf
                | "pattern" ->
                    JsonRead.propWith "pattern" JsonRead.str e
                    |> Result.map FieldRule.Matches
                | other -> Error("unknown field type " + other + " for " + name)

            return name, rule
        }

    let private transitionRule (e: JsonElement) =
        result {
            let! from = JsonRead.propWith "from" JsonRead.str e
            let! ``to`` = JsonRead.propWith "to" JsonRead.str e
            let! roles = JsonRead.propWith "roles" JsonRead.strings e
            let! rationale = JsonRead.optPropWith "roleRationale" JsonRead.str e
            let! reasonRequired = JsonRead.propWith "reasonRequired" JsonRead.bool e
            do! if reasonRequired then Ok() else Error "every transition requires a reason in this candidate model"
            let! required = JsonRead.propWith "requiredFields" JsonRead.strings e
            let! optional = JsonRead.propWith "optionalFields" JsonRead.strings e
            let! evidence = JsonRead.propWith "evidenceAnyOf" JsonRead.strings e

            return
                { From = from
                  To = ``to``
                  Roles = roles
                  RoleRationale = rationale
                  RequiredFields = required
                  OptionalFields = optional
                  EvidenceAnyOf = evidence }
        }

    let private machine (e: JsonElement) =
        result {
            let! states = JsonRead.propWith "states" JsonRead.strings e
            let! initial = JsonRead.propWith "initial" JsonRead.str e
            let! terminal = JsonRead.propWith "terminal" JsonRead.strings e
            let! dispositions = JsonRead.optPropWith "dispositions" JsonRead.strings e
            let! transitions = JsonRead.propWith "transitions" (JsonRead.array transitionRule) e

            return
                { States = states
                  Initial = initial
                  Terminal = terminal
                  Dispositions = Option.defaultValue [] dispositions
                  Transitions = transitions }
        }

    let private unique xs = List.length (List.distinct xs) = List.length xs

    let private check condition message = if condition then Ok() else Error message

    /// Semantic integrity: the same checks as loadTable in service/lifecycle.mjs.
    let private validateMachine name roles (fields: Map<string, FieldRule>) (kinds: Map<string, string>) (m: MachineDefinition) =
        let ruleProblem (t: TransitionRule) =
            let pair = t.From + "->" + t.To
            let declared = t.RequiredFields @ t.OptionalFields

            if not (List.contains t.From m.States && List.contains t.To m.States) then
                Some("transition " + pair + " references an unknown state")
            elif List.isEmpty t.Roles || not (t.Roles |> List.forall (fun r -> List.contains r roles)) then
                Some("transition " + pair + " has unknown roles")
            elif not (unique declared) || not (declared |> List.forall fields.ContainsKey) then
                Some("transition " + pair + " declares unknown fields")
            elif not (t.EvidenceAnyOf |> List.forall (fun k -> kinds.ContainsKey k && k <> "unspecified")) then
                Some("transition " + pair + " has invalid evidence kinds")
            else
                None

        result {
            do! check (not (List.isEmpty m.States) && unique m.States) (name + " states invalid")
            do! check (List.contains m.Initial m.States) (name + " initial state unknown")
            do! check (m.Terminal |> List.forall (fun s -> List.contains s m.States)) (name + " terminal state unknown")
            let pairs = m.Transitions |> List.map (fun t -> t.From, t.To)
            do! check (unique pairs) ("duplicate transition in " + name)

            match m.Transitions |> List.tryPick ruleProblem with
            | Some problem -> return! Error problem
            | None -> return ()
        }

    let private parseRoot (root: JsonElement) =
        result {
            let! version = JsonRead.propWith "schemaVersion" JsonRead.str root
            do! check (version = "1.0") "unsupported table schemaVersion"
            let! authority = JsonRead.propWith "authority" JsonRead.str root
            let! ordo = JsonRead.propWith "ordoAuthorized" JsonRead.bool root

            do!
                check
                    (authority = "vitium-domain-candidate" && not ordo)
                    "only the Vitium candidate table is accepted; Ordo authority is not claimed"

            let! tableVersion = JsonRead.propWith "tableVersion" JsonRead.str root
            let! roles = JsonRead.propWith "roles" JsonRead.strings root
            do! check (not (List.isEmpty roles) && unique roles) "roles must be a non-empty unique list"
            let! provenanceText = JsonRead.propWith "commandProvenances" JsonRead.strings root
            let provenances = provenanceText |> List.choose Provenance.ofWire
            do! check (List.length provenances = List.length provenanceText) "unknown command provenance"
            let! kindEntries = JsonRead.propWith "evidenceKinds" JsonRead.objectEntries root

            let! kinds =
                kindEntries
                |> JsonRead.traverse (fun (k, v) -> JsonRead.propWith "label" JsonRead.str v |> Result.map (fun l -> k, l))

            let! fieldEntries = JsonRead.propWith "fields" JsonRead.objectEntries root
            let! fields = fieldEntries |> JsonRead.traverse fieldRule
            let fieldMap = Map.ofList fields
            let kindMap = Map.ofList kinds
            let! reasonMax = JsonRead.propWith "reasonMaxLength" JsonRead.int root
            do! check (reasonMax > 0) "reasonMaxLength required"
            let! machines = JsonRead.prop "machines" root
            let! observation = JsonRead.propWith "observation" machine machines
            let! defect = JsonRead.propWith "defect" machine machines
            do! validateMachine "observation" roles fieldMap kindMap observation
            do! validateMachine "defect" roles fieldMap kindMap defect

            do!
                check
                    (Set.isEmpty (Set.intersect (Set.ofList observation.States) (Set.ofList defect.States)))
                    "a state belongs to more than one machine"

            let! promotion = JsonRead.prop "promotion" root
            let! fromState = JsonRead.propWith "fromState" JsonRead.str promotion
            let! toState = JsonRead.propWith "toState" JsonRead.str promotion
            let! promotionRoles = JsonRead.propWith "roles" JsonRead.strings promotion

            do!
                check
                    (List.contains fromState observation.States && toState = defect.Initial)
                    "promotion must start from an observation state and create the defect initial state"

            let! facts = JsonRead.prop "facts" root
            let! factEntries = JsonRead.propWith "kinds" JsonRead.objectEntries facts

            let! factRules =
                factEntries
                |> JsonRead.traverse (fun (k, v) ->
                    result {
                        let! r = JsonRead.propWith "roles" JsonRead.strings v
                        let! ev = JsonRead.propWith "evidenceAnyOf" JsonRead.strings v
                        return k, { Roles = r; EvidenceAnyOf = ev }
                    })

            return
                { TableVersion = tableVersion
                  RoleList = roles
                  CommandProvenanceList = provenances
                  EvidenceKindLabels = kindMap
                  FieldRules = fieldMap
                  ReasonLimit = reasonMax
                  ObservationMachine = observation
                  DefectMachine = defect
                  PromotionRule =
                    { FromState = fromState
                      ToState = toState
                      Roles = promotionRoles }
                  FactRules = Map.ofList factRules }
        }

    /// Parse and validate a transition table document. Fails closed.
    let parse (json: string) : Result<Table, string> =
        try
            use doc = JsonDocument.Parse json
            parseRoot doc.RootElement
        with :? JsonException as ex ->
            Error("malformed JSON: " + ex.Message)

    /// Legal (from, to) pairs of a machine.
    let legalPairs (table: Table) machine =
        (table.Definition machine).Transitions |> List.map (fun t -> t.From, t.To)

    /// Targets a role may choose from a state (what a UI may offer).
    let permittedTargets (table: Table) machine from role =
        (table.Definition machine).Transitions
        |> List.filter (fun t -> t.From = from && List.contains role t.Roles)
        |> List.map (fun t -> t.To)
