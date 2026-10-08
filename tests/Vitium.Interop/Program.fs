/// Cross-language contract proof: the real EchelonFoundry.Vitium.Client talks HTTPS to the real
/// Vitium machine-intake handler (tests/interop/machine-intake-server.mjs). Run by tests/interop/run.sh.
open System
open System.Net.Http
open System.Security.Cryptography
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open EchelonFoundry.Vitium.Contracts
open EchelonFoundry.Vitium.Client

let baseUrl = Environment.GetEnvironmentVariable "VITIUM_INTEROP_URL"
let pinnedCert = Environment.GetEnvironmentVariable "VITIUM_INTEROP_CERT_SHA256"

let clientWith (token: string) =
    // Trust only the harness's own self-signed certificate, pinned by SHA-256.
    let handler = new HttpClientHandler()
    handler.ServerCertificateCustomValidationCallback <-
        fun _ cert _ _ -> not (isNull cert) && String.Equals(cert.GetCertHashString(HashAlgorithmName.SHA256), pinnedCert, StringComparison.OrdinalIgnoreCase)
    let http = new HttpClient(handler, BaseAddress = Uri baseUrl)
    let tokens = { new IAccessTokenProvider with member _.GetAccessTokenAsync _ = Task.FromResult token }
    VitiumClient(http, tokens) :> IVitiumClient

let praxis = clientWith "interop-praxis-token-0001"
let otherRepo = clientWith "interop-other-token-00001"
let source = { System = "praxis"; Repository = "kemiller2002/summa"; InstallationId = "praxis-ci-1"; Version = "3.7.2" }
let evidence = [| { Kind = "test-result"; Uri = "https://github.com/kemiller2002/summa/actions/runs/123"; Sha256 = String.replicate 64 "a" } |]
let commit = String.replicate 40 "b"

// DateTimeOffset.UtcNow serializes as "+00:00" with 7 fractional digits: the real .NET wire format.
let observation eventId summary causation =
    { SchemaVersion = "1.0"; EventId = eventId; EventType = "observation.detected"; Source = source
      Subject = { WorkItemId = "WI-0042"; Commit = commit; RunId = "run-123"; CheckId = "verify-abi"; Environment = "ci" }
      Finding = { Category = "test-failure"; Summary = summary; Expected = "Route matches binding"; Observed = "Binding assertion failed"
                  Classification = "untriaged"; Confidence = "observed" }
      Evidence = evidence
      Correlation = { DefectId = ""; VerificationAttemptId = ""; CausationEventId = causation }
      ObservedAt = DateTimeOffset.UtcNow }

let verification eventId outcome =
    { SchemaVersion = "1.0"; EventId = eventId; DefectId = "VIT-0042"; AttemptId = "attempt-1"; CandidateRevision = commit
      WorkItemId = "WI-0042"; ExpectedDefectRevision = 6L; Outcome = outcome; Source = source; Evidence = evidence
      ObservedAt = DateTimeOffset.UtcNow }

let run (task: Task<Result<Receipt, ApiError>>) = task.GetAwaiter().GetResult()
let expect condition description = if not condition then failwithf "INTEROP FAILED: %s" description

let ok description = function
    | Ok receipt -> receipt
    | Error error -> failwithf "INTEROP FAILED: %s: %s %s (%d)" description error.Code error.Message error.StatusCode

let refused description = function
    | Ok receipt -> failwithf "INTEROP FAILED: %s was accepted (%s)" description receipt.Reference
    | Error error -> error

let original = observation (Guid.NewGuid()) "Routing contract failed" ""
let first = praxis.ReportObservationAsync(original, CancellationToken.None) |> run |> ok "observation"
expect (first.Status = "received" && not first.Replayed && first.Reference.StartsWith "VIT-M") "observation receipt"

// A retry resends the identical value, as a producer outbox does.
let replay = praxis.ReportObservationAsync(original, CancellationToken.None) |> run |> ok "replay"
expect (replay.Replayed && replay.Reference = first.Reference && replay.AcceptedAt = first.AcceptedAt) "replay returns the original receipt"

let conflict = praxis.ReportObservationAsync({ original with Finding = { original.Finding with Summary = "Rewritten summary" } }, CancellationToken.None) |> run |> refused "conflicting replay"
expect (conflict.StatusCode = 409 && not conflict.Retryable) "conflicting replay is a non-retryable 409"

let verified = praxis.SubmitVerificationAsync(verification (Guid.NewGuid()) "failed", CancellationToken.None) |> run |> ok "verification result"
expect (verified.Status = "received") "verification result receipt"

let echo = praxis.ReportObservationAsync(observation (Guid.NewGuid()) "Echo of Vitium update" "vitium:issue-update-1", CancellationToken.None) |> run |> ok "echo"
expect (echo.Status = "suppressed") "Vitium echoes are acknowledged as suppressed"

let scope = otherRepo.ReportObservationAsync(observation (Guid.NewGuid()) "Wrong repository" "", CancellationToken.None) |> run |> refused "out-of-scope sender"
expect (scope.StatusCode = 403 && not scope.Retryable) "repository scope is enforced"

let secret = praxis.ReportObservationAsync(observation (Guid.NewGuid()) ("leaked ghp_" + String.replicate 36 "x") "", CancellationToken.None) |> run |> refused "credential in summary"
expect (secret.StatusCode = 400 && not secret.Retryable) "credentials are refused"

let badOutcome = praxis.SubmitVerificationAsync(verification (Guid.NewGuid()) "resolved", CancellationToken.None) |> run |> refused "forged outcome"
expect (badOutcome.StatusCode = 400) "unknown verification outcome is refused"

let stats =
    use http = new HttpClient(new HttpClientHandler(ServerCertificateCustomValidationCallback = fun _ _ _ _ -> true), BaseAddress = Uri baseUrl)
    http.GetStringAsync("/__interop/stats").GetAwaiter().GetResult() |> JsonDocument.Parse
expect (stats.RootElement.GetProperty("stored").GetInt32() = 2) "exactly one observation and one verification result were stored"

printfn "Vitium F# client <-> machine intake interop passed (8 scenarios)."
