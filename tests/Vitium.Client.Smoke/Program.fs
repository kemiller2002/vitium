open System
open System.Net
open System.Net.Http
open System.Threading
open System.Threading.Tasks
open EchelonFoundry.Vitium.Contracts
open EchelonFoundry.Vitium.Client

let assertTrue result description =
    if not result then failwith description

type ProbeHandler(status: HttpStatusCode, body: string) =
    inherit HttpMessageHandler()

    let mutable requestedPath = ""
    let mutable authorization = ""
    let mutable idempotency = ""
    let mutable wireJson = ""

    member _.RequestedPath = requestedPath
    member _.Authorization = authorization
    member _.Idempotency = idempotency
    member _.WireJson = wireJson

    override _.SendAsync(request: HttpRequestMessage, cancellationToken: CancellationToken) =
        task {
            requestedPath <- request.RequestUri.AbsolutePath
            authorization <- request.Headers.Authorization.ToString()
            idempotency <- request.Headers.GetValues("Idempotency-Key") |> Seq.head
            wireJson <- request.Content.ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult()
            let response = new HttpResponseMessage(status)
            response.Content <- new StringContent(body)
            return response
        }

let tokenProvider =
    { new IAccessTokenProvider with
        member _.GetAccessTokenAsync(_ct) = Task.FromResult("short-lived-identity-token") }

let eventId = Guid.Parse("0276f8ac-a673-4d62-85a7-5d2292ef0cdd")
let identity =
    { System = "praxis"
      Repository = "kemiller2002/summa"
      InstallationId = "qualified-instance"
      Version = "3.8.0" }

let evidence =
    { Kind = "test-result"
      Uri = "https://github.com/kemiller2002/summa/actions/runs/123"
      Sha256 = String.replicate 64 "a" }

let observation =
    { SchemaVersion = "1.0"
      EventId = eventId
      EventType = "observation.detected"
      Source = identity
      Subject =
        { WorkItemId = "WI-0042"
          Commit = String.replicate 40 "a"
          RunId = "123"
          CheckId = "verification-contract"
          Environment = "ci" }
      Finding =
        { Category = "test-failure"
          Summary = "A relevant regression failed"
          Expected = "The routing contract passes"
          Observed = "Routing assertion failed"
          Classification = "untriaged"
          Confidence = "observed" }
      Evidence = [| evidence |]
      Correlation =
        { DefectId = ""
          VerificationAttemptId = ""
          CausationEventId = "" }
      ObservedAt = DateTimeOffset.Parse("2026-10-08T12:00:00+00:00") }

let receipt =
    """{"schemaVersion":"1.0","reference":"VIT-ABCD0123","acceptedAt":"2026-10-08T12:00:00Z","status":"received","replayed":false}"""

let reportWith status response =
    let probe = new ProbeHandler(status, response)
    use http = new HttpClient(probe)
    http.BaseAddress <- Uri("https://intake.vitium.echelonfoundry.com/")
    let client = VitiumClient(http, tokenProvider) :> IVitiumClient
    let result = client.ReportObservationAsync(observation, CancellationToken.None).GetAwaiter().GetResult()
    result, probe

let accepted, probe = reportWith HttpStatusCode.Created receipt
match accepted with
| Ok result ->
    assertTrue (result.Reference = "VIT-ABCD0123") "The receipt should identify the accepted event"
    assertTrue (result.Status = "received") "A receipt is not a resolution"
| Error _ -> failwith "An acknowledged observation must return Ok"

assertTrue (probe.RequestedPath = "/api/v1/observations") "The client must use the machine observation route"
assertTrue (probe.Authorization = "Bearer short-lived-identity-token") "Expected injected bearer credentials"
assertTrue (probe.Idempotency = eventId.ToString("D")) "The event id must be the stable idempotency key"
assertTrue (probe.WireJson.Contains("\"eventType\":\"observation.detected\"")) "The outgoing JSON must use the schema's camelCase"
assertTrue (probe.WireJson.Contains("\"repository\":\"kemiller2002/summa\"")) "The outgoing JSON must preserve source"

let unavailable, _ = reportWith HttpStatusCode.ServiceUnavailable "unavailable"
match unavailable with
| Error error ->
    assertTrue (error.Retryable && error.StatusCode = 503) "Transient failures must be observable as retryable"
| Ok _ -> failwith "503 must not be acknowledged"

let unauthenticated, _ = reportWith HttpStatusCode.Unauthorized "unauthorized"
match unauthenticated with
| Error error -> assertTrue (not error.Retryable && error.StatusCode = 401) "401 must not be retried blindly"
| Ok _ -> failwith "Unauthorized requests must not be acknowledged"

let forgedReceipt, _ = reportWith HttpStatusCode.Created """{"status":"resolved","reference":"bad"}"""
match forgedReceipt with
| Error error -> assertTrue (error.Code = "invalid_receipt") "Invalid receipts must be refused"
| Ok _ -> failwith "A response claiming resolution is not an intake receipt"

let suppressed, _ =
    reportWith HttpStatusCode.Accepted """{"schemaVersion":"1.0","reference":"VIT-M0276","acceptedAt":"2026-10-08T12:00:00Z","status":"suppressed","replayed":false}"""
match suppressed with
| Ok receipt -> assertTrue (receipt.Status = "suppressed") "A suppressed echo is delivered, not failed"
| Error error -> failwithf "A suppressed acknowledgement must not be an error: %s" error.Code

let verification =
    { SchemaVersion = "1.0"
      EventId = Guid.Parse("e9d2d556-41ec-4cc4-bd0a-d03a5b0db188")
      DefectId = "VIT-1234"
      AttemptId = "fix-2"
      CandidateRevision = String.replicate 40 "b"
      WorkItemId = "WI-0042"
      ExpectedDefectRevision = 3L
      Outcome = "failed"
      Source = identity
      Evidence = [| evidence |]
      ObservedAt = DateTimeOffset.Parse("2026-10-08T12:00:00+00:00") }

let verifyProbe = new ProbeHandler(HttpStatusCode.Accepted, receipt)
use verificationHttp = new HttpClient(verifyProbe)
verificationHttp.BaseAddress <- Uri("https://intake.vitium.echelonfoundry.com/")
let verificationClient = VitiumClient(verificationHttp, tokenProvider) :> IVitiumClient
let response = verificationClient.SubmitVerificationAsync(verification,CancellationToken.None).GetAwaiter().GetResult()
assertTrue (verifyProbe.RequestedPath = "/api/v1/verification-results") "Verification must be a distinct event route"
assertTrue (verifyProbe.WireJson.Contains("\"outcome\":\"failed\"")) "Failure evidence must not be changed into a passing result"
assertTrue (verifyProbe.WireJson.Contains("\"expectedDefectRevision\":3")) "Expected revision must be transmitted"
match response with
| Ok result -> assertTrue (result.Status = "received") "A verification ingestion receipt is not an accepted transition"
| Error _ -> failwith "Verification result should be acknowledged"

let badSchema = { observation with SchemaVersion = "2.0" }
let noCallProbe = new ProbeHandler(HttpStatusCode.Created, receipt)
use noCallHttp = new HttpClient(noCallProbe)
noCallHttp.BaseAddress <- Uri("https://intake.vitium.echelonfoundry.com")
let noCallClient = VitiumClient(noCallHttp, tokenProvider) :> IVitiumClient
match noCallClient.ReportObservationAsync(badSchema,CancellationToken.None).GetAwaiter().GetResult() with
| Error error -> assertTrue (error.Code = "unsupported_schema") "Unknown payload versions must fail locally"
| Ok _ -> failwith "Unsupported contract was acknowledged"
assertTrue (noCallProbe.RequestedPath = "") "Unsupported schema must not be transmitted"

let httpRejected =
    try
        use insecure = new HttpClient(new ProbeHandler(HttpStatusCode.Created, receipt))
        insecure.BaseAddress <- Uri("http://insecure.example")
        let _ = VitiumClient(insecure, tokenProvider)
        false
    with :? ArgumentException -> true
assertTrue httpRejected "Cleartext machine HTTP must be forbidden"

printfn "Vitium NuGet consumer contract smoke tests passed."
