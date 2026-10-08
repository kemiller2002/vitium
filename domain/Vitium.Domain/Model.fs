namespace Vitium.Domain

open System

/// Triage judgements that are independent of each other and of reported impact
/// (VIT-DOM-006). None is defaulted or inferred: absent means not assessed.
[<RequireQualifiedAccess>]
type Severity =
    | Critical
    | High
    | Medium
    | Low

[<RequireQualifiedAccess>]
type Priority =
    | Urgent
    | High
    | Normal
    | Low

[<RequireQualifiedAccess>]
type Confidence =
    | High
    | Medium
    | Low

type TriageAssessment =
    { Classification: string option
      Severity: Severity option
      Priority: Priority option
      Confidence: Confidence option
      Owner: string option }

/// Where a record came from. `Channel` is the intake path; `Provenance` the class of
/// the reporter. Neither invents a person's identity.
type Source =
    { Channel: string
      Provenance: Provenance }

/// A private, unverified observation (VIT-LCY-002). It is never converted into a defect.
type Observation =
    { Id: ObservationId
      Reference: ExternalReference
      Report: Report
      Source: Source
      ReceivedAt: DateTimeOffset
      Lifecycle: LifecycleRecord }

/// A defect identity, created by explicit promotion of a classified observation.
type Defect =
    { Id: DefectId
      Observations: ObservationId list
      Product: ProductId option
      Evidence: Evidence list
      WorkItems: WorkItemRef list
      Lifecycle: LifecycleRecord }

[<RequireQualifiedAccess>]
module TriageAssessment =

    let empty =
        { Classification = None
          Severity = None
          Priority = None
          Confidence = None
          Owner = None }

    /// Read typed judgements out of lifecycle triage fields. Unknown values are ignored,
    /// never coerced (the table already validated vocabulary on entry).
    let ofLifecycle (record: LifecycleRecord) =
        let get k = Map.tryFind k record.Triage

        { Classification = get "classification"
          Severity =
            get "severity"
            |> Option.bind (function
                | "critical" -> Some Severity.Critical
                | "high" -> Some Severity.High
                | "medium" -> Some Severity.Medium
                | "low" -> Some Severity.Low
                | _ -> None)
          Priority =
            get "priority"
            |> Option.bind (function
                | "urgent" -> Some Priority.Urgent
                | "high" -> Some Priority.High
                | "normal" -> Some Priority.Normal
                | "low" -> Some Priority.Low
                | _ -> None)
          Confidence =
            get "confidence"
            |> Option.bind (function
                | "high" -> Some Confidence.High
                | "medium" -> Some Confidence.Medium
                | "low" -> Some Confidence.Low
                | _ -> None)
          Owner = get "owner" }

/// Effects are parameters (ports), never ambient. Naming follows Arca's ports
/// (a record of functions, cf. Arca.StorageProvider) without depending on Arca.
[<NoEquality; NoComparison>]
type ObservationPorts =
    { /// Clock effect.
      Now: unit -> DateTimeOffset
      /// Opaque receipt reference generator (randomness lives outside the core).
      NewReference: unit -> ExternalReference
      /// Internal observation id derived by the adapter (e.g. from the idempotency key).
      NewObservationId: unit -> ObservationId }

[<RequireQualifiedAccess>]
module Observation =

    /// Build a new private observation from normalised content. Pure apart from the
    /// effects passed in through `ports`.
    let receive (table: Table) (ports: ObservationPorts) (source: Source) (report: Report) : Observation =
        let id = ports.NewObservationId()

        { Id = id
          Reference = ports.NewReference()
          Report = report
          Source = source
          ReceivedAt = ports.Now()
          Lifecycle = Lifecycle.initial table Machine.Observation (Some(RecordIdentity.Observation id)) }
