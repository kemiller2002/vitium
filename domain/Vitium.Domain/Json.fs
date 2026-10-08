namespace Vitium.Domain

open System.Text.Json

/// Minimal, total readers over System.Text.Json (shared framework; no NuGet).
/// Every reader returns a Result so malformed data is a typed failure, never an exception.
module internal JsonRead =

    let tryProp (name: string) (e: JsonElement) =
        if e.ValueKind = JsonValueKind.Object then
            match e.TryGetProperty name with
            | true, v -> Some v
            | _ -> None
        else
            None

    let prop name e =
        match tryProp name e with
        | Some v -> Ok v
        | None -> Error(sprintf "missing property %s" name)

    let str (e: JsonElement) =
        if e.ValueKind = JsonValueKind.String then Ok(e.GetString()) else Error "expected string"

    let int (e: JsonElement) =
        match e.ValueKind with
        | JsonValueKind.Number ->
            match e.TryGetInt32() with
            | true, v -> Ok v
            | _ -> Error "expected 32-bit integer"
        | _ -> Error "expected integer"

    let bool (e: JsonElement) =
        match e.ValueKind with
        | JsonValueKind.True -> Ok true
        | JsonValueKind.False -> Ok false
        | _ -> Error "expected boolean"

    let traverse (f: 'a -> Result<'b, 'e>) (items: 'a seq) : Result<'b list, 'e> =
        let folder acc item =
            match acc, f item with
            | Ok xs, Ok x -> Ok(x :: xs)
            | Error e, _ -> Error e
            | _, Error e -> Error e
        items |> Seq.fold folder (Ok []) |> Result.map List.rev

    let array (f: JsonElement -> Result<'a, string>) (e: JsonElement) =
        if e.ValueKind = JsonValueKind.Array then traverse f (e.EnumerateArray()) else Error "expected array"

    let strings e = array str e

    let objectEntries (e: JsonElement) =
        if e.ValueKind = JsonValueKind.Object then
            Ok(e.EnumerateObject() |> Seq.map (fun p -> p.Name, p.Value) |> List.ofSeq)
        else
            Error "expected object"

    let propWith name f e = prop name e |> Result.bind f |> Result.mapError (fun m -> name + ": " + m)

    let optPropWith name f e =
        match tryProp name e with
        | None -> Ok None
        | Some v when v.ValueKind = JsonValueKind.Null -> Ok None
        | Some v -> f v |> Result.map Some |> Result.mapError (fun m -> name + ": " + m)

[<AutoOpen>]
module internal ResultSyntax =
    type ResultBuilder() =
        member _.Bind(r, f) = Result.bind f r
        member _.Return x = Ok x
        member _.ReturnFrom r = r
        member _.Zero() = Ok()

    let result = ResultBuilder()
