namespace Vitium.Domain

open System
open System.Text.RegularExpressions

/// Reporter input exactly as received at the boundary (untrusted). Only the
/// allow-listed fields of intake-request schema v1 exist here; everything else
/// is refused before this type is built by an adapter.
type RawReport =
    { SchemaVersion: string
      Product: string
      Impact: string
      Title: string
      Actual: string
      Expected: string
      Steps: string option
      PageUrl: string option
      PrivacyAcknowledged: bool }

/// Typed validation failure for report normalisation (VIT-API-002, domain side).
[<RequireQualifiedAccess>]
type ReportError =
    | UnsupportedVersion of string
    | PrivacyNotAcknowledged
    | Required of field: string
    | TooLong of field: string * max: int
    | InvalidCharacters of field: string
    | Product of RegistryError
    | Impact of RegistryError
    | InvalidPageUrl
    | NonHttpPageUrl
    | CredentialDetected

/// Normalised reporter content. Reported impact is what the reporter said; it is not
/// severity, priority or confidence (VIT-DOM-006).
type Report =
    { Product: ProductResolution
      ReportedImpact: ReportedImpact
      Title: string
      Actual: string
      Expected: string
      Steps: string
      PageUrl: string }

[<RequireQualifiedAccess>]
module Report =

    // Same guardrail as service/report-domain.mjs: obvious credential disclosures only,
    // not a claim of comprehensive DLP.
    let private credential =
        Regex(
            "(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{15,}|sk-[A-Za-z0-9_-]{18,}|(?:password|api[_ -]?key)\\s*[:=]\\s*\\S{4,})",
            RegexOptions.IgnoreCase ||| RegexOptions.CultureInvariant
        )

    // Control characters except tab-free line breaks (\n, \r) are refused.
    let private hasBinary (text: string) =
        text
        |> Seq.exists (fun c ->
            (c >= '\u0000' && c <= '\u0008') || c = '\u000b' || c = '\u000c' || (c >= '\u000e' && c <= '\u001f') || c = '\u007f')

    let private field name max mandatory (value: string option) =
        let clean = value |> Option.map (fun v -> v.Trim()) |> Option.defaultValue ""

        if mandatory && clean = "" then Error(ReportError.Required name)
        elif clean.Length > max then Error(ReportError.TooLong(name, max))
        elif hasBinary clean then Error(ReportError.InvalidCharacters name)
        else Ok clean

    let private sanitiseUrl (text: string) =
        if text = "" then
            Ok ""
        else
            match Uri.TryCreate(text, UriKind.Absolute) with
            | false, _ -> Error ReportError.InvalidPageUrl
            | true, uri when uri.Scheme <> Uri.UriSchemeHttp && uri.Scheme <> Uri.UriSchemeHttps -> Error ReportError.NonHttpPageUrl
            // Drop credentials (user-info), query and fragment: they may contain secrets.
            // Same result as JS `url.origin + url.pathname`. Authority excludes user-info.
            | true, uri -> Ok(uri.Scheme + "://" + uri.Authority + uri.AbsolutePath)

    /// Deterministic normalisation. Pure: same input and registry, same output.
    let normalise (registry: Registry) (raw: RawReport) : Result<Report, ReportError> =
        result {
            do! if raw.SchemaVersion = "1.0" then Ok() else Error(ReportError.UnsupportedVersion raw.SchemaVersion)
            do! if raw.PrivacyAcknowledged then Ok() else Error ReportError.PrivacyNotAcknowledged
            let! productText = field "application" 100 true (Option.ofObj raw.Product)
            let! impactText = field "impact" 100 true (Option.ofObj raw.Impact)
            let! product = Registry.resolveProduct registry productText |> Result.mapError ReportError.Product
            let! impact = Registry.resolveImpact registry impactText |> Result.mapError ReportError.Impact
            let! title = field "summary" 120 true (Option.ofObj raw.Title)
            let! actual = field "what happened" 1200 true (Option.ofObj raw.Actual)
            let! expected = field "what was expected" 1200 true (Option.ofObj raw.Expected)
            let! steps = field "steps to reproduce" 900 false raw.Steps
            let! pageText = field "page URL" 2000 false raw.PageUrl
            let! pageUrl = sanitiseUrl pageText
            let text = String.Join("\n", [ title; actual; expected; steps ])
            do! if credential.IsMatch text then Error ReportError.CredentialDetected else Ok()

            return
                { Product = product
                  ReportedImpact = impact.Impact
                  Title = title
                  Actual = actual
                  Expected = expected
                  Steps = steps
                  PageUrl = pageUrl }
        }
