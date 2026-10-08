namespace EchelonFoundry.Vitium.Client

open System
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open EchelonFoundry.Vitium.Contracts

/// Implementations must obtain short-lived, scope-limited machine credentials.
type IAccessTokenProvider =
    abstract GetAccessTokenAsync: cancellationToken: CancellationToken -> Task<string>

[<CLIMutable>]
type ApiError =
    { Code: string
      Message: string
      StatusCode: int
      Retryable: bool }

type IVitiumClient =
    abstract ReportObservationAsync:
        observation: Observation * cancellationToken: CancellationToken -> Task<Result<Receipt, ApiError>>

    abstract SubmitVerificationAsync:
        verification: VerificationResult * cancellationToken: CancellationToken -> Task<Result<Receipt, ApiError>>

/// A transport client, not the defect-state authority. An acknowledged verification
/// result never automatically resolves a defect: Vitium/Ordo must verify and apply policy.
[<Sealed>]
type VitiumClient(httpClient: HttpClient, tokenProvider: IAccessTokenProvider) =
    do
        if isNull (box httpClient) then
            nullArg "httpClient"

        if isNull (box tokenProvider) then
            nullArg "tokenProvider"

        if isNull httpClient.BaseAddress || httpClient.BaseAddress.Scheme <> Uri.UriSchemeHttps then
            invalidArg "httpClient" "A configured HTTPS base address is required for machine reporting."

    let jsonOptions = JsonSerializerOptions(JsonSerializerDefaults.Web)

    let makeError code message status retryable =
        Error { Code = code; Message = message; StatusCode = status; Retryable = retryable }

    let send (route: string) (eventId: Guid) (payload: obj) (ct: CancellationToken) =
        task {
            if eventId = Guid.Empty then
                return makeError "invalid_event_id" "A stable event ID is required." 0 false
            else
                try
                    let! token = tokenProvider.GetAccessTokenAsync(ct)

                    if String.IsNullOrWhiteSpace token then
                        return makeError "authentication_unavailable" "Machine identity token was unavailable." 0 false
                    else
                        use request = new HttpRequestMessage(HttpMethod.Post, route)
                        request.Headers.Authorization <- AuthenticationHeaderValue("Bearer", token)
                        request.Headers.Add("Idempotency-Key", eventId.ToString("D"))
                        request.Content <- new StringContent(
                            JsonSerializer.Serialize(payload, payload.GetType(), jsonOptions),
                            Encoding.UTF8,
                            "application/json"
                        )

                        use! response = httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct)

                        if not response.IsSuccessStatusCode then
                            let status = int response.StatusCode
                            let retryable =
                                response.StatusCode = HttpStatusCode.TooManyRequests
                                || status >= 500

                            return makeError "ingestion_rejected" "Vitium did not accept the event." status retryable
                        else
                            let! stream = response.Content.ReadAsStreamAsync(ct)
                            let! receipt = JsonSerializer.DeserializeAsync<Receipt>(stream, jsonOptions, ct)

                            // "suppressed" acknowledges an intentional no-op (an echo of Vitium's own
                            // update); it is delivered, not failed, and must not be retried.
                            if isNull (box receipt)
                               || String.IsNullOrWhiteSpace receipt.Reference
                               || not (receipt.Status = "received" || receipt.Status = "suppressed") then
                                return makeError "invalid_receipt" "Vitium returned an invalid acknowledgement." (int response.StatusCode) false
                            else
                                return Ok receipt

                with
                | :? OperationCanceledException when ct.IsCancellationRequested ->
                    return raise (OperationCanceledException("Vitium request cancelled.", ct))
                | :? OperationCanceledException ->
                    return makeError "transport_timeout" "The report request timed out." 0 true
                | :? HttpRequestException ->
                    return makeError "transport_unavailable" "Vitium is unreachable." 0 true
                | :? JsonException ->
                    return makeError "invalid_receipt" "Vitium returned an invalid acknowledgement." 0 false
        }

    interface IVitiumClient with
        member _.ReportObservationAsync(observation, cancellationToken) =
            if isNull (box observation) then
                Task.FromResult(makeError "invalid_observation" "An observation is required." 0 false)
            elif observation.SchemaVersion <> "1.0" then
                Task.FromResult(makeError "unsupported_schema" "Unsupported observation contract." 0 false)
            else
                send "/api/v1/observations" observation.EventId (box observation) cancellationToken

        member _.SubmitVerificationAsync(verification, cancellationToken) =
            if isNull (box verification) then
                Task.FromResult(makeError "invalid_verification" "A verification result is required." 0 false)
            elif verification.SchemaVersion <> "1.0" then
                Task.FromResult(makeError "unsupported_schema" "Unsupported verification contract." 0 false)
            else
                send "/api/v1/verification-results" verification.EventId (box verification) cancellationToken
