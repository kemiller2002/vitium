namespace Vitium.Domain

open System
open System.Text
open System.Text.Json
open System.Text.RegularExpressions

/// One registry product. `IsUnknown` marks the explicit "Other / not sure" choice.
type Product =
    { Id: ProductId
      DisplayName: string
      Aliases: string list
      IsUnknown: bool }

/// Reporter-stated impact (VIT-DOM-006). Never a severity or priority.
[<RequireQualifiedAccess>]
type ReportedImpact =
    | CannotUse
    | Workaround
    | Minor
    | Unknown

type ImpactEntry = { Impact: ReportedImpact; Id: string; DisplayName: string }

/// The canonical, versioned product registry (schemas/products.v1.json).
type Registry =
    private
        { Version: string
          ProductList: Product list
          ByKey: Map<string, ProductId>
          ById: Map<string, Product>
          ImpactList: ImpactEntry list }

    member this.RegistryVersion = this.Version
    member this.Products = this.ProductList
    member this.Impacts = this.ImpactList

[<RequireQualifiedAccess>]
type RegistryError =
    | InvalidRegistry of string
    | ProductRequired
    | UnsupportedProduct of string
    | ImpactRequired
    | UnsupportedImpact of string

/// The result of resolving reporter text. `MatchedAlias` is true when only an alias matched.
type ProductResolution =
    { Product: Product
      MatchedAlias: bool }

[<RequireQualifiedAccess>]
module Registry =

    let private whitespace = Regex("\\s+", RegexOptions.CultureInvariant)

    /// Deterministic alias key: NFKC, trim, collapse whitespace, lower-case (invariant).
    /// Identical to aliasKey in service/product-registry.mjs.
    let aliasKey (text: string) =
        let n = text.Normalize(NormalizationForm.FormKC).Trim()
        whitespace.Replace(n, " ").ToLowerInvariant()

    let private impactOfId id =
        match id with
        | "cannot-use" -> Some ReportedImpact.CannotUse
        | "workaround" -> Some ReportedImpact.Workaround
        | "minor" -> Some ReportedImpact.Minor
        | "unknown" -> Some ReportedImpact.Unknown
        | _ -> None

    let private parseProduct (e: JsonElement) =
        result {
            let! idText = JsonRead.propWith "id" JsonRead.str e
            let! id = ProductId.create idText |> Result.mapError (fun _ -> "invalid product id " + idText)
            let! displayName = JsonRead.propWith "displayName" JsonRead.str e
            let! aliases = JsonRead.propWith "aliases" JsonRead.strings e
            let! unknown = JsonRead.optPropWith "unknown" JsonRead.bool e

            if String.IsNullOrWhiteSpace displayName then
                return! Error "empty displayName"
            else
                return
                    { Id = id
                      DisplayName = displayName
                      Aliases = aliases
                      IsUnknown = unknown = Some true }
        }

    let private parseImpact (e: JsonElement) =
        result {
            let! id = JsonRead.propWith "id" JsonRead.str e
            let! displayName = JsonRead.propWith "displayName" JsonRead.str e

            match impactOfId id with
            | Some impact -> return { Impact = impact; Id = id; DisplayName = displayName }
            | None -> return! Error("unknown impact id " + id)
        }

    let private index (products: Product list) =
        let folder acc (p: Product) =
            acc
            |> Result.bind (fun (map: Map<string, ProductId>) ->
                let keys = (ProductId.value p.Id :: p.DisplayName :: p.Aliases) |> List.map aliasKey |> List.distinct

                keys
                |> List.fold
                    (fun inner key ->
                        inner
                        |> Result.bind (fun (m: Map<string, ProductId>) ->
                            match Map.tryFind key m with
                            | Some other when other <> p.Id -> Error("alias " + key + " is ambiguous")
                            | _ -> Ok(Map.add key p.Id m)))
                    (Ok map))

        products |> List.fold folder (Ok Map.empty)

    /// Parse and validate a registry document. Fails closed on ambiguity.
    let parse (json: string) : Result<Registry, RegistryError> =
        let attempt () =
            use doc = JsonDocument.Parse json
            let root = doc.RootElement

            result {
                let! version = JsonRead.propWith "schemaVersion" JsonRead.str root
                do! if version = "1.0" then Ok() else Error "unsupported registry version"
                let! registryVersion = JsonRead.propWith "registryVersion" JsonRead.str root
                let! products = JsonRead.propWith "products" (JsonRead.array parseProduct) root
                let! impacts = JsonRead.propWith "impacts" (JsonRead.array parseImpact) root
                let ids = products |> List.map (fun p -> ProductId.value p.Id)
                do! if List.length (List.distinct ids) = List.length ids then Ok() else Error "duplicate product id"
                let unknowns = products |> List.filter (fun p -> p.IsUnknown)

                do!
                    match unknowns with
                    | [ u ] when ProductId.value u.Id = "unknown" -> Ok()
                    | _ -> Error "exactly one explicit 'unknown' product (id unknown) is required"

                let! byKey = index products

                return
                    { Version = registryVersion
                      ProductList = products
                      ByKey = byKey
                      ById = products |> List.map (fun p -> ProductId.value p.Id, p) |> Map.ofList
                      ImpactList = impacts }
            }

        try
            attempt () |> Result.mapError RegistryError.InvalidRegistry
        with :? JsonException as ex ->
            Error(RegistryError.InvalidRegistry("malformed JSON: " + ex.Message))

    /// Resolve an id, display name or alias. Unknown text is refused, never mapped to another product.
    let resolveProduct (registry: Registry) (text: string) : Result<ProductResolution, RegistryError> =
        if String.IsNullOrWhiteSpace text then
            Error RegistryError.ProductRequired
        elif text.Length > 100 || Patterns.hasControl text then
            Error(RegistryError.UnsupportedProduct text)
        else
            let key = aliasKey text

            match Map.tryFind key registry.ByKey with
            | None -> Error(RegistryError.UnsupportedProduct text)
            | Some id ->
                let p = registry.ById[ProductId.value id]

                Ok
                    { Product = p
                      MatchedAlias = key <> aliasKey (ProductId.value p.Id) && key <> aliasKey p.DisplayName }

    /// Resolve a reported impact by id or display name.
    let resolveImpact (registry: Registry) (text: string) : Result<ImpactEntry, RegistryError> =
        if String.IsNullOrWhiteSpace text then
            Error RegistryError.ImpactRequired
        else
            let t = text.Trim()

            registry.ImpactList
            |> List.tryFind (fun i -> i.Id = t || i.DisplayName = t)
            |> function
                | Some i -> Ok i
                | None -> Error(RegistryError.UnsupportedImpact text)
