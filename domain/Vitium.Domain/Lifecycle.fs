namespace Vitium.Domain

open System

/// One evidence item supplied with a command. Kind is a table-defined evidence kind.
type Evidence = { Kind: string; Ref: EvidenceRef }

/// The identity of the record a lifecycle applies to. Observations and defects are
/// different identities; promotion links them, never converts one into the other.
[<RequireQualifiedAccess>]
type RecordIdentity =
    | Observation of ObservationId
    | Defect of DefectId

/// The disposition a reopen overrides, kept so closure evidence stays reachable (VIT-AC-012).
type ClosureRef =
    { Sequence: int
      State: string
      Evidence: Evidence list }

/// Append-only lifecycle events. Facts (merged/built/deployed/...) are events, not states.
[<RequireQualifiedAccess>]
type Event =
    | Transitioned of TransitionEvent
    | Promoted of PromotionEvent
    | Created of CreationEvent
    | FactRecorded of FactEvent
    /// An event read back from persisted history whose full shape this core does not
    /// re-type (e.g. a v1 JS event). Kept verbatim as JSON text; only what the guards need
    /// (sequence, target state, evidence) is typed.
    | Recorded of RecordedEvent

and TransitionEvent =
    { Sequence: int
      Machine: Machine
      From: string
      To: string
      Actor: Actor
      Reason: string
      Fields: Map<string, string>
      Evidence: Evidence list
      Reopens: ClosureRef option
      OccurredAt: DateTimeOffset }

and PromotionEvent =
    { Sequence: int
      Defect: DefectId
      Actor: Actor
      Reason: string
      OccurredAt: DateTimeOffset }

and CreationEvent =
    { Sequence: int
      FromObservation: ObservationId option
      Actor: Actor
      Reason: string
      OccurredAt: DateTimeOffset }

and RecordedEvent =
    { Sequence: int
      To: string option
      Evidence: Evidence list
      Json: string }

and FactEvent =
    { Sequence: int
      Fact: string
      State: string
      Actor: Actor
      Evidence: Evidence list
      OccurredAt: DateTimeOffset }

[<RequireQualifiedAccess>]
module Event =
    let sequence e =
        match e with
        | Event.Transitioned t -> t.Sequence
        | Event.Promoted p -> p.Sequence
        | Event.Created c -> c.Sequence
        | Event.FactRecorded f -> f.Sequence
        | Event.Recorded r -> r.Sequence

/// The lifecycle part of an observation or defect. `State` is a table state name: the
/// table, not this type, is the authority on which states and transitions exist.
type LifecycleRecord =
    { Machine: Machine
      Identity: RecordIdentity option
      State: string
      Revision: int
      /// Chronological, append-only.
      History: Event list
      /// Independent triage judgements (classification, severity, priority, ...).
      Triage: Map<string, string>
      /// Defects this observation was promoted into (observations only).
      LinkedDefects: DefectId list }

/// A request to move a record to another state.
type TransitionCommand =
    { To: string
      ExpectedRevision: int
      Reason: string
      Fields: Map<string, string>
      Evidence: Evidence list
      OccurredAt: DateTimeOffset }

type PromotionCommand =
    { ExpectedRevision: int
      /// Supplied by the caller's id effect; the core never generates identities.
      NewDefect: DefectId
      Reason: string
      OccurredAt: DateTimeOffset }

type FactCommand =
    { Fact: string
      ExpectedRevision: int
      Evidence: Evidence list
      OccurredAt: DateTimeOffset }

/// Why a lifecycle command was refused. `TransitionError.code` gives the wire code
/// shared with service/lifecycle.mjs.
[<RequireQualifiedAccess>]
type TransitionError =
    | InvalidPayload of string
    | UnknownMachine of string
    | UnknownState of string
    | MissingActor
    | InvalidProvenance of string
    | StaleRevision of expected: int * actual: int
    | ForbiddenTransition of from: string * ``to``: string
    | UnauthorizedRole of role: string * rationale: string option
    | MissingReason
    | ReasonTooLong of max: int
    | InvalidTimestamp
    | UnexpectedField of string
    | MissingField of string
    | InvalidField of string
    | InvalidEvidence of string
    | MissingEvidence of anyOf: string list
    | SelfReference of string
    | InvalidDefectId of string
    | UnknownFact of string
    /// The record's history does not account for its revision (VF-016).
    | InconsistentHistory of events: int * revision: int

[<RequireQualifiedAccess>]
module TransitionError =
    let code e =
        match e with
        | TransitionError.InvalidPayload _ -> "invalid_payload"
        | TransitionError.UnknownMachine _ -> "unknown_machine"
        | TransitionError.UnknownState _ -> "unknown_state"
        | TransitionError.MissingActor -> "missing_actor"
        | TransitionError.InvalidProvenance _ -> "invalid_provenance"
        | TransitionError.StaleRevision _ -> "stale_revision"
        | TransitionError.ForbiddenTransition _ -> "forbidden_transition"
        | TransitionError.UnauthorizedRole _ -> "unauthorized_role"
        | TransitionError.MissingReason -> "missing_reason"
        | TransitionError.ReasonTooLong _ -> "reason_too_long"
        | TransitionError.InvalidTimestamp -> "invalid_timestamp"
        | TransitionError.UnexpectedField _ -> "unexpected_field"
        | TransitionError.MissingField _ -> "missing_field"
        | TransitionError.InvalidField _ -> "invalid_field"
        | TransitionError.InvalidEvidence _ -> "invalid_evidence"
        | TransitionError.MissingEvidence _ -> "missing_evidence"
        | TransitionError.SelfReference _ -> "self_reference"
        | TransitionError.InvalidDefectId _ -> "invalid_defect_id"
        | TransitionError.UnknownFact _ -> "unknown_fact"
        | TransitionError.InconsistentHistory _ -> "inconsistent_history"

/// Pure lifecycle evaluation driven by the transition table.
[<RequireQualifiedAccess>]
module Lifecycle =

    let private check condition error = if condition then Ok() else Error error

    /// Fields that are relationships or links, not triage judgements.
    let private relationshipFields = set [ "duplicateOf"; "supersededBy"; "workItemRef" ]

    let private checkActor (table: Table) (actor: Actor) =
        check
            (List.contains actor.Provenance table.CommandProvenances)
            (TransitionError.InvalidProvenance(Provenance.toWire actor.Provenance))

    let private checkRevision (record: LifecycleRecord) expected =
        check
            (record.Revision >= 0 && record.Revision = expected)
            (TransitionError.StaleRevision(expected, record.Revision))

    /// History is append-only: one non-creation event per revision. A record whose history
    /// was truncated (or padded) is refused rather than extended (VF-016). F# lists and
    /// records are immutable, so no caller alias can rewrite a past event.
    let private checkHistory (record: LifecycleRecord) =
        let events = record.History |> List.filter (fun e -> Event.sequence e <> 0) |> List.length
        check (events = record.Revision) (TransitionError.InconsistentHistory(events, record.Revision))

    let private checkReason (table: Table) (reason: string) =
        if String.IsNullOrWhiteSpace reason then Error TransitionError.MissingReason
        elif reason.Length > table.ReasonMaxLength then Error(TransitionError.ReasonTooLong table.ReasonMaxLength)
        else Ok(reason.Trim())

    let private fieldValid (rule: FieldRule) (value: string) =
        not (String.IsNullOrWhiteSpace value)
        && match rule with
           | FieldRule.OneOf values -> List.contains value values
           | FieldRule.Matches pattern -> System.Text.RegularExpressions.Regex.IsMatch(value, pattern, System.Text.RegularExpressions.RegexOptions.CultureInvariant)
           | FieldRule.Text max -> value.Length <= max && not (Patterns.hasControl value)

    let private checkFields (table: Table) (rule: TransitionRule) (fields: Map<string, string>) =
        let declared = rule.RequiredFields @ rule.OptionalFields

        match fields |> Map.toList |> List.tryFind (fun (k, _) -> not (List.contains k declared)) with
        | Some(k, _) -> Error(TransitionError.UnexpectedField k)
        | None ->
            match rule.RequiredFields |> List.tryFind (fun f -> not (fields.ContainsKey f)) with
            | Some f -> Error(TransitionError.MissingField f)
            | None ->
                match fields |> Map.toList |> List.tryFind (fun (k, v) -> not (fieldValid table.Fields[k] v)) with
                | Some(k, _) -> Error(TransitionError.InvalidField k)
                | None -> Ok(fields |> Map.map (fun _ v -> v.Trim()))

    let private checkEvidence (table: Table) (anyOf: string list) (evidence: Evidence list) =
        match evidence |> List.tryFind (fun e -> not (table.EvidenceKinds.ContainsKey e.Kind)) with
        | Some e -> Error(TransitionError.InvalidEvidence e.Kind)
        | None ->
            check
                (List.isEmpty anyOf || evidence |> List.exists (fun e -> List.contains e.Kind anyOf))
                (TransitionError.MissingEvidence anyOf)

    let private ownDefectId (record: LifecycleRecord) =
        match record.Identity with
        | Some(RecordIdentity.Defect id) -> Some(DefectId.value id)
        | _ -> None

    let private checkSelfReference (record: LifecycleRecord) (fields: Map<string, string>) =
        match ownDefectId record with
        | None -> Ok()
        | Some own ->
            match [ "duplicateOf"; "supersededBy" ] |> List.tryFind (fun f -> Map.tryFind f fields = Some own) with
            | Some f -> Error(TransitionError.SelfReference f)
            | None -> Ok()

    let private lastDisposition (definition: MachineDefinition) (history: Event list) =
        history
        |> List.rev
        |> List.tryPick (fun e ->
            match e with
            | Event.Transitioned t when List.contains t.To definition.Dispositions ->
                Some
                    { Sequence = t.Sequence
                      State = t.To
                      Evidence = t.Evidence }
            | Event.Recorded r when (match r.To with
                                     | Some s -> List.contains s definition.Dispositions
                                     | None -> false) ->
                Some
                    { Sequence = r.Sequence
                      State = Option.defaultValue "" r.To
                      Evidence = r.Evidence }
            | _ -> None)

    /// The authorization part of a transition: source state, actor provenance, revision,
    /// legal edge, role and reason, in the same order as service/lifecycle.mjs. Returns the
    /// matched rule and the trimmed reason. `transition` is built on this function.
    let authorize
        (table: Table)
        (actor: Actor)
        (target: string)
        (expectedRevision: int)
        (reason: string)
        (record: LifecycleRecord)
        : Result<TransitionRule * string, TransitionError> =
        let definition = table.Definition record.Machine

        result {
            do! check (List.contains record.State definition.States) (TransitionError.UnknownState record.State)
            do! checkActor table actor
            do! checkRevision record expectedRevision
            do! checkHistory record

            let! rule =
                definition.Transitions
                |> List.tryFind (fun t -> t.From = record.State && t.To = target)
                |> function
                    | Some r -> Ok r
                    | None -> Error(TransitionError.ForbiddenTransition(record.State, target))

            do! check (List.contains actor.Role rule.Roles) (TransitionError.UnauthorizedRole(actor.Role, rule.RoleRationale))
            let! trimmed = checkReason table reason
            return rule, trimmed
        }

    /// Evaluate a transition. Pure and total: same inputs, same Result.
    let transition
        (table: Table)
        (actor: Actor)
        (command: TransitionCommand)
        (record: LifecycleRecord)
        : Result<LifecycleRecord * Event, TransitionError> =
        let definition = table.Definition record.Machine

        result {
            let! rule, reason = authorize table actor command.To command.ExpectedRevision command.Reason record
            let! fields = checkFields table rule command.Fields
            do! checkEvidence table rule.EvidenceAnyOf command.Evidence
            do! checkSelfReference record fields
            let reopens = if command.To = "reopened" then lastDisposition definition record.History else None

            let event =
                Event.Transitioned
                    { Sequence = record.Revision + 1
                      Machine = record.Machine
                      From = record.State
                      To = command.To
                      Actor = actor
                      Reason = reason
                      Fields = fields
                      Evidence = command.Evidence
                      Reopens = reopens
                      OccurredAt = command.OccurredAt }

            let triage =
                fields
                |> Map.filter (fun k _ -> not (relationshipFields.Contains k))
                |> Map.fold (fun acc k v -> Map.add k v acc) record.Triage

            return
                { record with
                    State = command.To
                    Revision = record.Revision + 1
                    History = record.History @ [ event ]
                    Triage = triage },
                event
        }

    /// Promote a classified observation into a NEW defect identity (VIT-LCY-002).
    /// Returns the updated observation (same identity, same state, one link event) and
    /// the new defect record. The observation is never turned into a defect.
    let promote
        (table: Table)
        (actor: Actor)
        (command: PromotionCommand)
        (observation: LifecycleRecord)
        : Result<LifecycleRecord * LifecycleRecord * Event, TransitionError> =
        let rule = table.Promotion

        result {
            do! check (observation.Machine = Machine.Observation) (TransitionError.UnknownMachine "promotion applies to observations only")
            do! checkActor table actor
            do! checkRevision observation command.ExpectedRevision
            do! checkHistory observation
            do! check (observation.State = rule.FromState) (TransitionError.ForbiddenTransition(observation.State, "promoted"))
            do! check (List.contains actor.Role rule.Roles) (TransitionError.UnauthorizedRole(actor.Role, None))
            let! reason = checkReason table command.Reason

            do!
                check
                    (not (List.contains command.NewDefect observation.LinkedDefects))
                    (TransitionError.InvalidDefectId(DefectId.value command.NewDefect))

            let observationId =
                match observation.Identity with
                | Some(RecordIdentity.Observation id) -> Some id
                | _ -> None

            let link =
                Event.Promoted
                    { Sequence = observation.Revision + 1
                      Defect = command.NewDefect
                      Actor = actor
                      Reason = reason
                      OccurredAt = command.OccurredAt }

            let created =
                Event.Created
                    { Sequence = 0
                      FromObservation = observationId
                      Actor = actor
                      Reason = reason
                      OccurredAt = command.OccurredAt }

            let defect =
                { Machine = Machine.Defect
                  Identity = Some(RecordIdentity.Defect command.NewDefect)
                  State = rule.ToState
                  Revision = 0
                  History = [ created ]
                  Triage = Map.empty
                  LinkedDefects = [] }

            let updated =
                { observation with
                    Revision = observation.Revision + 1
                    History = observation.History @ [ link ]
                    LinkedDefects = observation.LinkedDefects @ [ command.NewDefect ] }

            return updated, defect, link
        }

    /// Record a fix fact. Never changes state (VIT-VER-005 groundwork).
    let recordFact
        (table: Table)
        (actor: Actor)
        (command: FactCommand)
        (record: LifecycleRecord)
        : Result<LifecycleRecord * Event, TransitionError> =
        result {
            do! check (record.Machine = Machine.Defect) (TransitionError.UnknownMachine "facts apply to defects only")

            let! rule =
                match Map.tryFind command.Fact table.Facts with
                | Some r -> Ok r
                | None -> Error(TransitionError.UnknownFact command.Fact)

            do! checkActor table actor
            do! checkRevision record command.ExpectedRevision
            do! checkHistory record
            do! check (List.contains actor.Role rule.Roles) (TransitionError.UnauthorizedRole(actor.Role, None))
            do! checkEvidence table rule.EvidenceAnyOf command.Evidence

            let event =
                Event.FactRecorded
                    { Sequence = record.Revision + 1
                      Fact = command.Fact
                      State = record.State
                      Actor = actor
                      Evidence = command.Evidence
                      OccurredAt = command.OccurredAt }

            return
                { record with
                    Revision = record.Revision + 1
                    History = record.History @ [ event ] },
                event
        }

    /// A fresh lifecycle record in the machine's initial state.
    let initial (table: Table) machine identity =
        { Machine = machine
          Identity = identity
          State = (table.Definition machine).Initial
          Revision = 0
          History = []
          Triage = Map.empty
          LinkedDefects = [] }
