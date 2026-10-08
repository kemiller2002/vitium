namespace Vitium.Domain

open System
open System.Text.Json

/// Decoding of the strict wire command shape shared with service/lifecycle.mjs
/// (see schemas/lifecycle/transition-cases.v1.json). Pure: JSON in, typed values or a
/// typed TransitionError out, using the same error codes as the JS implementation.
/// Prior history events are decoded as `Event.Recorded` (sequence, target state and
/// evidence typed; the rest kept verbatim), so the history/revision guard and the reopen
/// closure link work on persisted records.
[<RequireQualifiedAccess>]
module Wire =

    let private payload message = TransitionError.InvalidPayload message

    let private optString name (e: JsonElement) =
        match JsonRead.tryProp name e with
        | Some v when v.ValueKind = JsonValueKind.String -> Some(v.GetString())
        | _ -> None

    let private decodeTimestamp (e: JsonElement) =
        match optString "occurredAt" e with
        | Some text when Patterns.isInstant text ->
            match DateTimeOffset.TryParse(text, Globalization.CultureInfo.InvariantCulture, Globalization.DateTimeStyles.RoundtripKind) with
            | true, value -> Ok value
            | _ -> Error TransitionError.InvalidTimestamp
        | _ -> Error TransitionError.InvalidTimestamp

    let private decodeRevision name (e: JsonElement) =
        match JsonRead.tryProp name e |> Option.map JsonRead.int with
        | Some(Ok v) -> Ok v
        | _ -> Error(payload (name + " must be an integer"))

    /// Actor = id + provenance (+ table role). Same checks/codes as the JS checkActor.
    let decodeActor (e: JsonElement) : Result<Actor, TransitionError> =
        match optString "actor" e |> Option.map ActorId.create with
        | Some(Ok id) ->
            match optString "provenance" e |> Option.bind Provenance.ofWire with
            | None -> Error(TransitionError.InvalidProvenance(defaultArg (optString "provenance" e) ""))
            | Some provenance ->
                Ok
                    { Id = id
                      Provenance = provenance
                      Role = defaultArg (optString "role" e) "" }
        | _ -> Error TransitionError.MissingActor

    let private decodeEvidence (e: JsonElement) =
        match JsonRead.tryProp "evidence" e with
        | None -> Ok []
        | Some arr when arr.ValueKind = JsonValueKind.Array ->
            arr.EnumerateArray()
            |> JsonRead.traverse (fun item ->
                let names =
                    if item.ValueKind = JsonValueKind.Object then
                        item.EnumerateObject() |> Seq.map (fun p -> p.Name) |> List.ofSeq
                    else
                        []

                match optString "kind" item, optString "ref" item |> Option.map EvidenceRef.create with
                | Some kind, Some(Ok reference) when names |> List.forall (fun n -> n = "kind" || n = "ref") ->
                    Ok { Kind = kind; Ref = reference }
                | kind, _ -> Error(TransitionError.InvalidEvidence(defaultArg kind "")))
        | Some _ -> Error(TransitionError.InvalidEvidence "evidence must be a list")

    let private decodeFields (e: JsonElement) =
        match JsonRead.tryProp "fields" e with
        | None -> Ok Map.empty
        | Some obj when obj.ValueKind = JsonValueKind.Object ->
            obj.EnumerateObject()
            |> Seq.filter (fun p -> p.Value.ValueKind <> JsonValueKind.Null)
            |> JsonRead.traverse (fun p ->
                if p.Value.ValueKind = JsonValueKind.String then Ok(p.Name, p.Value.GetString())
                else Error(TransitionError.InvalidField p.Name))
            |> Result.map Map.ofList
        | Some _ -> Error(TransitionError.InvalidField "fields")

    let private decodeRecorded revision (item: JsonElement) =
        if item.ValueKind <> JsonValueKind.Object then
            Error(TransitionError.InconsistentHistory(0, revision))
        else
            let sequence =
                match JsonRead.tryProp "sequence" item |> Option.map JsonRead.int with
                | Some(Ok n) -> n
                | _ -> -1

            decodeEvidence item
            |> Result.map (fun evidence ->
                // Field values: legacy events carry them at the top level, v1.2 events under
                // `fields` (which wins). Only string values are read.
                let strings (o: JsonElement) =
                    if o.ValueKind = JsonValueKind.Object then
                        o.EnumerateObject()
                        |> Seq.filter (fun p -> p.Value.ValueKind = JsonValueKind.String)
                        |> Seq.map (fun p -> p.Name, p.Value.GetString())
                        |> List.ofSeq
                    else
                        []

                let nested = JsonRead.tryProp "fields" item |> Option.map strings |> Option.defaultValue []

                Event.Recorded
                    { Sequence = sequence
                      To = optString "to" item
                      Type = optString "type" item
                      Fields = Map.ofList (strings item @ nested)
                      Evidence = evidence
                      Json = item.GetRawText() })

    /// Decode a wire record ({kind, state, revision, id?, observationId?, history: []}).
    let decodeRecord (e: JsonElement) : Result<LifecycleRecord, TransitionError> =
        result {
            let! machine =
                match optString "kind" e |> Option.bind Machine.ofWire with
                | Some m -> Ok m
                | None -> Error(TransitionError.UnknownMachine(defaultArg (optString "kind" e) ""))

            let! state =
                match optString "state" e with
                | Some s -> Ok s
                | None -> Error(payload "state required")

            let! revision = decodeRevision "revision" e

            let! identity =
                match machine, optString "id" e, optString "observationId" e with
                | Machine.Defect, Some id, _ ->
                    DefectId.create id |> Result.map (RecordIdentity.Defect >> Some) |> Result.mapError (fun _ -> payload "invalid defect id")
                | Machine.Observation, _, Some id ->
                    ObservationId.create id
                    |> Result.map (RecordIdentity.Observation >> Some)
                    |> Result.mapError (fun _ -> payload "invalid observation id")
                | _ -> Ok None

            let! history =
                match JsonRead.tryProp "history" e with
                | None -> Ok []
                | Some h when h.ValueKind = JsonValueKind.Array -> h.EnumerateArray() |> JsonRead.traverse (decodeRecorded revision)
                | Some _ -> Error(TransitionError.InconsistentHistory(0, revision))

            return
                { Machine = machine
                  Identity = identity
                  State = state
                  Revision = revision
                  History = history
                  Triage = Map.empty
                  LinkedDefects = [] }
        }

    /// Decode a strict wire transition command into (actor, command).
    let decodeTransition (e: JsonElement) : Result<Actor * TransitionCommand, TransitionError> =
        result {
            let! actor = decodeActor e
            let! expected = decodeRevision "expectedRevision" e
            let! occurredAt = decodeTimestamp e
            let! fields = decodeFields e
            let! evidence = decodeEvidence e

            return
                actor,
                { To = defaultArg (optString "to" e) ""
                  ExpectedRevision = expected
                  Reason = defaultArg (optString "reason" e) ""
                  Fields = fields
                  Evidence = evidence
                  OccurredAt = occurredAt }
        }

    /// Decode and evaluate with the same error precedence as service/lifecycle.mjs
    /// evaluateTransition. Guards live only in Lifecycle; this function only decodes.
    let evaluate (table: Table) (recordJson: JsonElement) (commandJson: JsonElement) =
        result {
            let! record = decodeRecord recordJson

            do!
                if List.contains record.State (table.Definition record.Machine).States then Ok()
                else Error(TransitionError.UnknownState record.State)

            let! actor = decodeActor commandJson
            let! expected = decodeRevision "expectedRevision" commandJson
            let target = defaultArg (optString "to" commandJson) ""
            let reason = defaultArg (optString "reason" commandJson) ""
            // Authorization first (shared with Lifecycle.transition), then decode the rest,
            // so error precedence matches service/lifecycle.mjs.
            let! _ = Lifecycle.authorize table actor target expected reason record
            let! _, command = decodeTransition commandJson
            return! Lifecycle.transition table actor command record
        }
