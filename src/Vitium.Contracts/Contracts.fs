namespace EchelonFoundry.Vitium.Contracts

open System

/// Identity is claimed by the sender but must be authorized against the authenticated principal.
[<CLIMutable>]
type ProducerIdentity =
    { System: string
      Repository: string
      InstallationId: string
      Version: string }

[<CLIMutable>]
type ObservationSubject =
    { WorkItemId: string
      Commit: string
      RunId: string
      CheckId: string
      Environment: string }

[<CLIMutable>]
type Finding =
    { Category: string
      Summary: string
      Expected: string
      Observed: string
      Classification: string
      Confidence: string }

/// A reference and digest, never raw logs or credential-bearing URL queries.
[<CLIMutable>]
type EvidenceReference =
    { Kind: string
      Uri: string
      Sha256: string }

[<CLIMutable>]
type Correlation =
    { DefectId: string
      VerificationAttemptId: string
      CausationEventId: string }

/// A machine observation is never a confirmed defect merely because it was emitted.
[<CLIMutable>]
type Observation =
    { SchemaVersion: string
      EventId: Guid
      EventType: string
      Source: ProducerIdentity
      Subject: ObservationSubject
      Finding: Finding
      Evidence: EvidenceReference array
      Correlation: Correlation
      ObservedAt: DateTimeOffset }

/// A test result is evidence. Only the Vitium/Ordo authority can change defect state.
[<CLIMutable>]
type VerificationResult =
    { SchemaVersion: string
      EventId: Guid
      DefectId: string
      AttemptId: string
      CandidateRevision: string
      WorkItemId: string
      ExpectedDefectRevision: int64
      Outcome: string
      Source: ProducerIdentity
      Evidence: EvidenceReference array
      ObservedAt: DateTimeOffset }

/// A receipt establishes acknowledged ingestion; it never means resolved.
[<CLIMutable>]
type Receipt =
    { SchemaVersion: string
      Reference: string
      AcceptedAt: DateTimeOffset
      Status: string
      Replayed: bool }
