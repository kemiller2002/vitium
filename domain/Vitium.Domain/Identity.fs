namespace Vitium.Domain

open System
open System.Text.RegularExpressions

/// Why a piece of text is not a valid identity. Typed so callers can react per kind.
[<RequireQualifiedAccess>]
type IdentityError =
    | InvalidObservationId of string
    | InvalidExternalReference of string
    | InvalidDefectId of string
    | InvalidProductId of string
    | InvalidActorId of string
    | InvalidEvidenceRef of string
    | InvalidWorkItemSystem of string
    | InvalidWorkItemRef of string

module internal Patterns =
    let private compile (p: string) = Regex(p, RegexOptions.CultureInvariant)
    // Same patterns as service/domain-records.mjs (identityPatterns).
    let observationId = compile "^OBS-[a-f0-9]{32}$"
    let externalReference = compile "^VIT-[A-F0-9]{32}$"
    let defectId = compile "^DEF-[0-9]{4,}$"
    let productId = compile "^[a-z][a-z0-9-]{0,63}$"
    let actorId = compile "^[A-Za-z0-9._:/+=,@-]{1,256}$"
    let workItemSystem = compile "^[a-z][a-z0-9-]{0,31}$"
    let timestamp = compile "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}"

    let hasControl (text: string) =
        text |> Seq.exists (fun c -> (c >= '\u0000' && c <= '\u001f') || c = '\u007f')

    let boundedText max (text: string) =
        not (String.IsNullOrWhiteSpace text) && text.Length <= max && not (hasControl text)

/// Internal observation identity. Never shown to reporters.
type ObservationId = private ObservationId of string

/// Opaque receipt reference, independent of any GitHub issue number (VIT-DOM-002).
type ExternalReference = private ExternalReference of string

/// Internal defect identity, created only by explicit promotion or migration.
type DefectId = private DefectId of string

/// Canonical product identity from the product registry.
type ProductId = private ProductId of string

/// Actor identity: an identifier, never a display name (aligned with Arca's ActorId).
type ActorId = private ActorId of string

/// Reference to a piece of evidence (test run, reproduction, decision record...).
type EvidenceRef = private EvidenceRef of string

/// A link to a remediation work item in some external system. The core does not know
/// GitHub: GitHub is just a `System` value chosen by an adapter.
type WorkItemRef = private { System: string; Ref: string }

[<RequireQualifiedAccess>]
module ObservationId =
    let create (text: string) =
        if not (isNull text) && Patterns.observationId.IsMatch text then Ok(ObservationId text)
        else Error(IdentityError.InvalidObservationId text)
    let value (ObservationId text) = text

[<RequireQualifiedAccess>]
module ExternalReference =
    let create (text: string) =
        if not (isNull text) && Patterns.externalReference.IsMatch text then Ok(ExternalReference text)
        else Error(IdentityError.InvalidExternalReference text)
    let value (ExternalReference text) = text

[<RequireQualifiedAccess>]
module DefectId =
    let create (text: string) =
        if not (isNull text) && Patterns.defectId.IsMatch text then Ok(DefectId text)
        else Error(IdentityError.InvalidDefectId text)
    let value (DefectId text) = text

[<RequireQualifiedAccess>]
module ProductId =
    let create (text: string) =
        if not (isNull text) && Patterns.productId.IsMatch text then Ok(ProductId text)
        else Error(IdentityError.InvalidProductId text)
    let value (ProductId text) = text

[<RequireQualifiedAccess>]
module ActorId =
    let create (text: string) =
        if not (isNull text) && Patterns.actorId.IsMatch text then Ok(ActorId text)
        else Error(IdentityError.InvalidActorId text)
    let value (ActorId text) = text

[<RequireQualifiedAccess>]
module EvidenceRef =
    let create (text: string) =
        if not (isNull text) && Patterns.boundedText 512 text then Ok(EvidenceRef(text.Trim()))
        else Error(IdentityError.InvalidEvidenceRef text)
    let value (EvidenceRef text) = text

[<RequireQualifiedAccess>]
module WorkItemRef =
    let create (system: string) (reference: string) =
        if isNull system || not (Patterns.workItemSystem.IsMatch system) then
            Error(IdentityError.InvalidWorkItemSystem system)
        elif isNull reference || not (Patterns.boundedText 512 reference) then
            Error(IdentityError.InvalidWorkItemRef reference)
        else
            Ok { System = system; Ref = reference.Trim() }
    let system (w: WorkItemRef) = w.System
    let reference (w: WorkItemRef) = w.Ref

/// Reporter/actor provenance class (VIT-DOM-005). Records the class only; it never
/// invents a person's identity or attribution.
[<RequireQualifiedAccess>]
type Provenance =
    | AnonymousHuman
    | AuthenticatedHuman
    | Application
    | Ci
    | Agent

[<RequireQualifiedAccess>]
module Provenance =
    let toWire p =
        match p with
        | Provenance.AnonymousHuman -> "anonymous-human"
        | Provenance.AuthenticatedHuman -> "authenticated-human"
        | Provenance.Application -> "application"
        | Provenance.Ci -> "ci"
        | Provenance.Agent -> "agent"

    let ofWire text =
        match text with
        | "anonymous-human" -> Some Provenance.AnonymousHuman
        | "authenticated-human" -> Some Provenance.AuthenticatedHuman
        | "application" -> Some Provenance.Application
        | "ci" -> Some Provenance.Ci
        | "agent" -> Some Provenance.Agent
        | _ -> None

/// Who acted, with what provenance class and in which (table-defined) role.
type Actor =
    { Id: ActorId
      Provenance: Provenance
      Role: string }
