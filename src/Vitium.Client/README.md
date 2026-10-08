# EchelonFoundry.Vitium.Client

Thin, typed F# NuGet client for **machine-to-machine** defect observations and
verification attempts. Uses injected `HttpClient` and an identity provider for
short-lived bearer credentials. No long-lived credentials, GitHub token, or
reporting endpoint is embedded in the package.

**Important:** Vitium's protected machine API is specified but not deployed.
Publishing this preview package does not make reporting operational.

### Intended consumer

```fsharp
open System
open System.Net.Http
open EchelonFoundry.Vitium.Client

let http = new HttpClient(BaseAddress = Uri("https://your-approved-vitium-api.example"))
// Provide IAccessTokenProvider through your trusted workload identity implementation.
let client = VitiumClient(http, tokenProvider)
```

Call `ReportObservationAsync` for detected failures or
`SubmitVerificationAsync` for actual independent test results. Passing tests
do not directly resolve defects; Vitium applies its governed transition rules.
