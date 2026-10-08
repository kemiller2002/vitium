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
    /// A non-transition verification or escalation event (inconclusive run, escalation).
    | Noted of NotedEvent
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
      /// Event type when recorded ("transition", "verification", "escalation", ...).
      Type: string option
      /// String values found under `fields` or at the top level (legacy events).
      Fields: Map<string, string>
      Evidence: Evidence list
      Json: string }

and NotedEvent =
    { Sequence: int
      /// "verification" (inconclusive run) or "escalation".
      Kind: string
      State: string
      Actor: Actor
      Reason: string
      Fields: Map<string, string>
      Evidence: Evidence list
      OccurredAt: DateTimeOffset }

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
        | Event.Noted n -> n.Sequence

    /// Target state, if the event is a transition (typed or recorded).
    let target e =
        match e with
        | Event.Transitioned t -> Some t.To
        | Event.Recorded r -> r.To
        | _ -> None

    /// A field value from a typed or recorded event.
    let field (key: string) e =
        match e with
        | Event.Transitioned t -> Map.tryFind key t.Fields
        | Event.Recorded r -> Map.tryFind key r.Fields
        | Event.Noted n -> Map.tryFind key n.Fields
        | _ -> None

    /// Event type: transition, verification, escalation, ...
    let kind e =
        match e with
        | Event.Transitioned _ -> "transition"
        | Event.Noted n -> n.Kind
        | Event.Recorded r -> Option.defaultValue "transition" r.Type
        | Event.Promoted _ -> "promoted"
        | Event.Created _ -> "created"
        | Event.FactRecorded _ -> "fact"

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
    | OutcomeMismatch of outcome: string * ``to``: string
    | AttemptMismatch
    | DuplicateAttempt of string
    | IndependenceRequired
    | EscalationRequired of failed: int * max: int
    | AuthorMismatch
    | ProvenanceConflict
    | HumanVerifierRequired
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
        | TransitionError.OutcomeMismatch _ -> "outcome_mismatch"
        | TransitionError.AttemptMismatch -> "attempt_mismatch"
        | TransitionError.DuplicateAttempt _ -> "duplicate_attempt"
        | TransitionError.IndependenceRequired -> "independence_required"
        | TransitionError.EscalationRequired _ -> "escalation_required"
        | TransitionError.AuthorMismatch -> "author_mismatch"
        | TransitionError.ProvenanceConflict -> "provenance_conflict"
        | TransitionError.HumanVerifierRequired -> "human_verifier_required"
        | TransitionError.UnknownFact _ -> "unknown_fact"
        | TransitionError.InconsistentHistory _ -> "inconsistent_history"

/// Pure lifecycle evaluation driven by the transition table.
[<RequireQualifiedAccess>]
module Lifecycle =

    let private check condition error = if condition then Ok() else Error error

    /// Fields that are independent triage judgements (everything else is a relationship,
    /// link or verification-cycle value, kept on the event only).
    let private triageFields = set [ "classification"; "severity"; "priority"; "confidence"; "productId"; "owner" ]

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

    /// The latest submission (attemptId, candidateRevision, author), every submitted
    /// attemptId, and failed results in the open cycle (since the last reopen/escalation).
    /// Same rules as verificationCycle in service/lifecycle.mjs.
    type Cycle =
        { Latest: (string option * string option * string option) option
          /// Submitting actor of the latest submission (author fallback for typed events).
          LatestActor: string option
          Submitted: string list
          FailedInOpenCycle: int }

    let cycle (history: Event list) =
        let submissions = history |> List.filter (fun e -> Event.target e = Some "awaiting-verification")

        let failed =
            history
            |> List.rev
            |> List.takeWhile (fun e -> Event.target e <> Some "reopened" && Event.kind e <> "escalation")
            // Only "failed" counts; an inconclusive run is never a failure (VIT-VER-010).
            |> List.filter (fun e -> Event.field "verificationOutcome" e = Some "failed")
            |> List.length

        { Latest =
            submissions
            |> List.tryLast
            |> Option.map (fun e -> Event.field "attemptId" e, Event.field "candidateRevision" e, Event.field "author" e)
          LatestActor =
            submissions
            |> List.tryLast
            |> Option.bind (fun e ->
                match e with
                | Event.Transitioned t -> Some(ActorId.value t.Actor.Id)
                | e -> Event.field "actor" e)
          Submitted = submissions |> List.choose (Event.field "attemptId")
          FailedInOpenCycle = failed }

    /// Bounded autonomous repair (VIT-VER-011): pure; `maxFailedAttempts` is explicit.
    let repairBudgetExhausted (history: Event list) (maxFailedAttempts: int) =
        (cycle history).FailedInOpenCycle >= maxFailedAttempts

    let private message (rule: TransitionRule) code fallback = Map.tryFind code rule.Messages |> Option.defaultValue fallback

    /// Attempt guards (same order and codes as checkAttempt in service/lifecycle.mjs).
    /// Returns extra fields to record.
    let private checkAttempt (table: Table) (rule: TransitionRule) (record: LifecycleRecord) (fields: Map<string, string>) (actor: Actor) maxFailed =
        let c = cycle record.History

        match rule.Attempt with
        | None -> Ok Map.empty
        | Some AttemptRule.Submission
        | Some AttemptRule.Rework when (match Map.tryFind "attemptId" fields with
                                        | Some a -> List.contains a c.Submitted
                                        | None -> false) ->
            Error(TransitionError.DuplicateAttempt(Map.find "attemptId" fields))
        | Some AttemptRule.Rework -> Ok Map.empty
        | Some AttemptRule.Submission ->
            // VF-027 fail closed: only a TRUSTED authenticated-human is exempt from the budget.
            let exempt = actor.Trusted && actor.Provenance = Provenance.AuthenticatedHuman

            if not exempt && c.FailedInOpenCycle >= maxFailed then
                Error(TransitionError.EscalationRequired(c.FailedInOpenCycle, maxFailed))
            else
                // VF-025: the author IS the submitter; a named author must canonically match it.
                match Map.tryFind "author" fields with
                | Some named when not (ActorId.sameAs actor.Id named) -> Error TransitionError.AuthorMismatch
                | _ -> Ok(Map.ofList [ "author", ActorId.value actor.Id ])
        | Some(AttemptRule.Result(outcome, independent)) ->
            match Map.tryFind "verificationOutcome" fields with
            | Some o when o <> outcome -> Error(TransitionError.OutcomeMismatch(o, rule.To))
            | _ ->
                match c.Latest with
                | Some _ when not (fields.ContainsKey "attemptId" && fields.ContainsKey "candidateRevision") ->
                    Error(TransitionError.MissingField(message rule "missing_field" "attemptId"))
                | Some(attempt, candidate, _) when attempt <> Map.tryFind "attemptId" fields || candidate <> Map.tryFind "candidateRevision" fields ->
                    Error TransitionError.AttemptMismatch
                | _ when outcome = "passed" && table.Policy.PassRequiresHumanVerifier && actor.Provenance <> Provenance.AuthenticatedHuman ->
                    // VF-028 (provisional): agent/application/ci may fail or mark inconclusive only.
                    Error TransitionError.HumanVerifierRequired
                | Some(_, _, author) when
                    independent
                    && table.Policy.IndependenceRequired
                    && List.contains outcome table.Policy.IndependenceAppliesTo
                    && (match Option.orElse c.LatestActor author with
                        | Some a -> ActorId.sameAs actor.Id a
                        | None -> false)
                    ->
                    Error TransitionError.IndependenceRequired
                | _ -> Ok(Map.ofList [ "verificationOutcome", outcome ])

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

    /// Evaluate a transition with an explicit repair budget for untrusted/agent submissions.
    let transitionWith
        (maxFailedAttempts: int)
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
            let! extra = checkAttempt table rule record fields actor maxFailedAttempts
            let fields = Map.fold (fun acc k v -> Map.add k v acc) fields extra
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
                |> Map.filter (fun k _ -> triageFields.Contains k)
                |> Map.fold (fun acc k v -> Map.add k v acc) record.Triage

            return
                { record with
                    State = command.To
                    Revision = record.Revision + 1
                    History = record.History @ [ event ]
                    Triage = triage },
                event
        }

    /// Evaluate a transition. Pure and total: same inputs, same Result. Uses the table's
    /// provisional repair budget and records the submitting actor as an attempt's author.
    let transition (table: Table) (actor: Actor) (command: TransitionCommand) (record: LifecycleRecord) =
        transitionWith table.Policy.MaxAutonomousFailedAttempts table actor command record

    let private notePrelude (table: Table) (rule: EventRule) (actor: Actor) expectedRevision (reason: string) (record: LifecycleRecord) =
        result {
            do! check (record.Machine = Machine.Defect) (TransitionError.UnknownMachine "this event applies to defects only")
            do! check (List.contains record.State (table.Definition record.Machine).States) (TransitionError.UnknownState record.State)
            do! checkActor table actor

            do!
                match rule.Provenances with
                | Some ps when not (List.contains actor.Provenance ps) -> Error(TransitionError.InvalidProvenance(Provenance.toWire actor.Provenance))
                | _ -> Ok()

            do! checkRevision record expectedRevision
            do! checkHistory record

            do!
                match rule.State with
                | Some st when st <> record.State -> Error(TransitionError.ForbiddenTransition(record.State, record.State))
                | _ -> Ok()

            do! check (List.contains actor.Role rule.Roles) (TransitionError.UnauthorizedRole(actor.Role, None))
            return! checkReason table reason
        }

    /// Inconclusive verification run (VIT-VER-010): an event, not a transition. The defect
    /// stays awaiting-verification and the run never counts as a failure.
    let recordInconclusive (table: Table) (actor: Actor) (command: TransitionCommand) (record: LifecycleRecord) =
        let rule = table.Events["verification-inconclusive"]

        result {
            let! reason = notePrelude table rule actor command.ExpectedRevision command.Reason record

            do!
                match rule.RequiredFields |> List.tryFind (fun f -> not (command.Fields.ContainsKey f)) with
                | Some f -> Error(TransitionError.MissingField f)
                | None -> Ok()

            do! checkEvidence table rule.EvidenceAnyOf command.Evidence

            do!
                match (cycle record.History).Latest with
                | Some(attempt, candidate, _) when attempt <> Map.tryFind "attemptId" command.Fields || candidate <> Map.tryFind "candidateRevision" command.Fields ->
                    Error TransitionError.AttemptMismatch
                | _ -> Ok()

            let event =
                Event.Noted
                    { Sequence = record.Revision + 1
                      Kind = "verification"
                      State = record.State
                      Actor = actor
                      Reason = reason
                      Fields =
                        Map.ofList
                            [ "attemptId", command.Fields["attemptId"]
                              "candidateRevision", command.Fields["candidateRevision"]
                              "verificationOutcome", "inconclusive" ]
                      Evidence = command.Evidence
                      OccurredAt = command.OccurredAt }

            return { record with Revision = record.Revision + 1; History = record.History @ [ event ] }, event
        }

    /// A human escalation; it opens a new autonomous repair budget (VIT-VER-011).
    let recordEscalation (table: Table) (actor: Actor) expectedRevision (reason: string) occurredAt (record: LifecycleRecord) =
        let rule = table.Events["escalation"]

        result {
            let! reason = notePrelude table rule actor expectedRevision reason record

            let event =
                Event.Noted
                    { Sequence = record.Revision + 1
                      Kind = "escalation"
                      State = record.State
                      Actor = actor
                      Reason = reason
                      Fields = Map.empty
                      Evidence = []
                      OccurredAt = occurredAt }

            return { record with Revision = record.Revision + 1; History = record.History @ [ event ] }, event
        }

    /// "Reopen and resume" (VIT-LCY-011): -> reopened then -> in-progress | reproducing,
    /// every guard applied, all-or-nothing; both events recorded.
    let reopenAndResume (table: Table) (actor: Actor) (reopen: TransitionCommand) (resumeActor: Actor) (resume: TransitionCommand) (record: LifecycleRecord) =
        result {
            do! check (resume.To = "in-progress" || resume.To = "reproducing") (TransitionError.InvalidPayload "the second step must resume in-progress or reproducing")
            let! reopened, first = transition table actor { reopen with To = "reopened" } record
            let! resumed, second = transition table resumeActor { resume with ExpectedRevision = reopened.Revision } reopened
            return resumed, [ first; second ]
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
