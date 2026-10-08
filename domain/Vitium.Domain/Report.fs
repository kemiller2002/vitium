namespace Vitium.Domain

open System
open System.Text
open System.Text.Json
open System.Text.RegularExpressions

/// Reporter input exactly as received at the boundary (untrusted). Only the
/// allow-listed fields of intake-request schema v1 exist here; an adapter refuses
/// everything else before building this type. `None` means the field was absent;
/// a JSON null or non-string is refused by the adapter (DOM-001 section 12).
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
    | UnsupportedProduct of string
    | UnsupportedImpact of string
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

/// The report text rules, compiled from schemas/report-text-rules.v1.json (the same
/// strings service/report-domain.mjs and intake-request.schema.json use).
[<NoComparison; NoEquality>]
type TextRules =
    private
        { Unsafe: Regex
          Whitespace: Regex
          Edges: Regex
          Credential: Regex
          PageUrl: Regex
          Limits: Map<string, int> }

[<RequireQualifiedAccess>]
module TextRules =

    let private compile (pattern: string) = Regex(pattern, RegexOptions.CultureInvariant)

    /// Parse the shared rules file. Fails closed on a missing or malformed entry.
    let parse (json: string) : Result<TextRules, string> =
        try
            use doc = JsonDocument.Parse json
            let root = doc.RootElement

            result {
                let! version = JsonRead.propWith "schemaVersion" JsonRead.str root
                do! if version = "1.0" then Ok() else Error "unsupported rules version"
                let! ws = JsonRead.propWith "whitespaceClass" JsonRead.str root
                let! unsafe = JsonRead.propWith "unsafeClass" JsonRead.str root
                let! credential = JsonRead.propWith "credentialPattern" JsonRead.str root
                let! limitEntries = JsonRead.propWith "limits" JsonRead.objectEntries root
                let! limits = limitEntries |> JsonRead.traverse (fun (k, v) -> JsonRead.int v |> Result.map (fun n -> k, n))
                // The schema's pageUrl pattern also lists \ud800-\udfff (lone surrogates in
                // ECMAScript "u" mode). .NET matches UTF-16 units, so that range is left out
                // here and lone surrogates are refused by the well-formedness check instead.
                let page =
                    "^(?:|[Hh][Tt][Tt][Pp][Ss]?://[^" + ws + "/?#" + unsafe + "]+(?:[/?#][^" + ws + unsafe + "]*)?)$"

                return
                    { Unsafe = compile ("[" + unsafe + "]")
                      Whitespace = compile ("^[" + ws + "]$")
                      Edges = compile ("^[" + ws + "]+|[" + ws + "]+$")
                      Credential = compile credential
                      PageUrl = compile page
                      Limits = Map.ofList limits }
            }
        with
        | :? JsonException as ex -> Error("malformed JSON: " + ex.Message)
        | :? ArgumentException as ex -> Error("invalid pattern: " + ex.Message)

[<RequireQualifiedAccess>]
module Report =

    /// UTF-16 well-formedness: no lone surrogates (JS String.prototype.isWellFormed).
    let private wellFormed (text: string) =
        let rec go i =
            if i >= text.Length then true
            elif Char.IsHighSurrogate text[i] then i + 1 < text.Length && Char.IsLowSurrogate text[i + 1] && go (i + 2)
            elif Char.IsLowSurrogate text[i] then false
            else go (i + 1)

        go 0

    /// Length in Unicode code points (JSON Schema maxLength semantics). Assumes well-formed.
    let codePoints (text: string) = text.EnumerateRunes() |> Seq.length

    /// At least one code point that is neither whitespace (shared class) nor a Unicode
    /// format character (General Category Cf), evaluated per code point as in JS "u" mode.
    let private hasVisible (rules: TextRules) (text: string) =
        text.EnumerateRunes()
        |> Seq.exists (fun r ->
            Rune.GetUnicodeCategory r <> Globalization.UnicodeCategory.Format
            && not (rules.Whitespace.IsMatch(r.ToString())))

    let private limit (rules: TextRules) name fallback = Map.tryFind name rules.Limits |> Option.defaultValue fallback

    /// Same order and outcomes as `field` in service/report-domain.mjs.
    let private field (rules: TextRules) label key required (value: string option) =
        match value with
        | None -> if required then Error(ReportError.Required label) else Ok ""
        | Some v when isNull v -> Error(ReportError.InvalidCharacters label)
        | Some v ->
            let max = limit rules key 0

            if not (wellFormed v) || rules.Unsafe.IsMatch v then Error(ReportError.InvalidCharacters label)
            elif codePoints v > max then Error(ReportError.TooLong(label, max))
            elif rules.Credential.IsMatch v then Error ReportError.CredentialDetected
            else
                let visible = hasVisible rules v

                if required && not visible then Error(ReportError.Required label)
                elif visible then Ok(rules.Edges.Replace(v, "").Normalize(NormalizationForm.FormC))
                else Ok ""

    let private pageUrl (rules: TextRules) (value: string option) =
        match value with
        | None -> Ok ""
        | Some v when isNull v -> Error ReportError.InvalidPageUrl
        | Some v when not (wellFormed v) || codePoints v > limit rules "pageUrl" 2000 -> Error ReportError.InvalidPageUrl
        | Some v when not (rules.PageUrl.IsMatch v) -> Error ReportError.NonHttpPageUrl
        | Some "" -> Ok ""
        | Some v ->
            match Uri.TryCreate(v, UriKind.Absolute) with
            | false, _ -> Error ReportError.InvalidPageUrl
            | true, uri when uri.Scheme <> Uri.UriSchemeHttp && uri.Scheme <> Uri.UriSchemeHttps -> Error ReportError.NonHttpPageUrl
            // Drop credentials (user-info), query and fragment: they may contain secrets.
            // Same result as JS `url.origin + url.pathname`. Authority excludes user-info.
            | true, uri -> Ok(uri.Scheme + "://" + uri.Authority + uri.AbsolutePath)

    /// Deterministic normalisation. Pure: same rules, registry and input, same output.
    /// v1 transport accepts exact display names only; aliases and padded names are refused
    /// here (they resolve only through Registry.resolveProduct, e.g. for migration).
    let normalise (rules: TextRules) (registry: Registry) (raw: RawReport) : Result<Report, ReportError> =
        result {
            do! if raw.SchemaVersion = "1.0" then Ok() else Error(ReportError.UnsupportedVersion raw.SchemaVersion)
            do! if raw.PrivacyAcknowledged then Ok() else Error ReportError.PrivacyNotAcknowledged

            let! product =
                match registry.Products |> List.tryFind (fun p -> p.DisplayName = raw.Product) with
                | Some p -> Ok { Product = p; MatchedAlias = false }
                | None -> Error(ReportError.UnsupportedProduct raw.Product)

            let! impact =
                match registry.Impacts |> List.tryFind (fun i -> i.DisplayName = raw.Impact) with
                | Some i -> Ok i
                | None -> Error(ReportError.UnsupportedImpact raw.Impact)

            let! title = field rules "summary" "title" true (Option.ofObj raw.Title)
            let! actual = field rules "what happened" "actual" true (Option.ofObj raw.Actual)
            let! expected = field rules "what was expected" "expected" true (Option.ofObj raw.Expected)
            let! steps = field rules "steps to reproduce" "steps" false raw.Steps
            let! page = pageUrl rules raw.PageUrl

            return
                { Product = product
                  ReportedImpact = impact.Impact
                  Title = title
                  Actual = actual
                  Expected = expected
                  Steps = steps
                  PageUrl = page }
        }
