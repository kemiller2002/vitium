# Build and publish the Vitium NuGet packages

This repository owns **two F# / .NET 10 preview libraries**:

| Package ID | Source | Purpose |
|---|---|---|
| `EchelonFoundry.Vitium.Contracts` | `src/Vitium.Contracts` | Versioned DTOs for machine observations, attempts, evidence and receipts |
| `EchelonFoundry.Vitium.Client` | `src/Vitium.Client` | `HttpClient` and short-lived machine identity transport |

Version initially: `0.1.0-preview.1`. This is a source/package candidate, **not an already published package or an operational API**. The machine API endpoints are not yet deployed. Consumer use is therefore meaningful only with an approved test server implementing the documented contract.

## 1. Build locally

Install a supported .NET 10 SDK and use a normal Vitium checkout.

```bash
cd vitium
dotnet --info
dotnet build src/Vitium.Contracts/Vitium.Contracts.fsproj -c Release
dotnet build src/Vitium.Client/Vitium.Client.fsproj -c Release
dotnet run --project tests/Vitium.Client.Smoke/Vitium.Client.Smoke.fsproj -c Release
mkdir -p artifacts/nuget
dotnet pack src/Vitium.Contracts/Vitium.Contracts.fsproj -c Release -o artifacts/nuget
dotnet pack src/Vitium.Client/Vitium.Client.fsproj -c Release -o artifacts/nuget
```

This produces the two versioned `.nupkg` files in `artifacts/nuget`. They are generated files and must not be checked in. GitHub Actions `nuget-ci.yml` builds, smoke-tests and creates these artifacts, but **does not publish anything**.

## 2. Test a package as a Praxis consumer

Once both archives exist locally, create an isolated test project or use a temporary Praxis clone. Do not edit the Praxis production dependency graph until the consumer build and compatibility are verified.

```bash
dotnet add path/to/consumer.fsproj package EchelonFoundry.Vitium.Client \
  --version 0.1.0-preview.1 \
  --source ./artifacts/nuget
dotnet restore path/to/consumer.fsproj --source ./artifacts/nuget --source https://api.nuget.org/v3/index.json
```

The client package references the matching Contracts package. The consuming application must supply a trusted `HttpClient` HTTPS base URL and an `IAccessTokenProvider` that obtains short-lived, scope-limited credentials from its own workload identity.

A successful local install is **not** permission to send production telemetry. Machine API, server validation, sender identity/scope, idempotent durable transport and governed lifecycle must pass integration checks first.

## 3. Choose the distribution boundary

**Public NuGet.org** is appropriate for redistributable SDK contracts/client code only after business ownership and package licensing are explicitly approved. Public packages are publicly downloadable even when they call a private API. Private package feeds are an alternative if the client implementation or contract must remain internal.

**No license is currently asserted** by these project files. Do not publish until the business owner has selected a license and approved public or private distribution; add the correct `PackageLicenseExpression` or approved packaged license file to both project files.

Before first release, verify package IDs do not conflict with existing nuget.org packages and select the NuGet owner (company organization versus personal account). Versions on NuGet are immutable: changes require a new version; never overwrite an existing package or reuse a preview version with different contents.

## 4. Configure safer public publishing through NuGet Trusted Publishing

Prefer [NuGet Trusted Publishing](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing) to a stored long-lived API key.

1. Log into **nuget.org** and create/select the intended Echelon owner account or organization.
2. Under **Trusted Publishing**, register a GitHub Actions policy: owner `kemiller2002`, repository `vitium`, workflow `nuget-publish.yml`, environment `nuget-release`. Scope publishing to `EchelonFoundry.Vitium.*` when supported.
3. In GitHub's repository Settings → Environments, create `nuget-release`, require a reviewer and restrict release to approved tags. This is an operator-controlled setting, not created by this documentation.
4. In GitHub Settings → Secrets and variables → Actions → Variables, set `NUGET_USER` to the NuGet profile username **(not an email or password)** that owns the trusted publishing policy.
5. Have engineering review the license, package metadata, source, API contract, tests, dependency graph, and provenance. Update versions in **both** projects together, then create the approved immutable `vitium-nuget-vX.Y.Z` tag on a validated commit.
6. Manually dispatch `.github/workflows/nuget-publish.yml` **against that tag**. Its tag and version checks prevent branch-tip or mismatched version publishing. It requires GitHub OIDC, gets a temporary NuGet credential and pushes Contracts before Client.

If NuGet Trusted Publishing is unavailable or you choose a private feed, use its documented scoped-credentials approach, never a hardcoded secret in the code, script or chat.

## 5. Consumer integration after publishing

With the release available at the chosen feed:

```bash
dotnet add src/Praxis.Infrastructure/Praxis.Infrastructure.fsproj \
  package EchelonFoundry.Vitium.Client --version X.Y.Z
```

Praxis already separates `Praxis.Domain`, `Praxis.Contracts`, `Praxis.Application`, `Praxis.Infrastructure`, and `Praxis.Cli`. Put the network adapter in **Praxis.Infrastructure** and route source events through a contract port. Avoid importing Vitium HTTP types into Praxis.Domain.

An observed failed test should emit an **observation**, not a confirmed defect. A repair verifier emits a **verification result**, not a direct resolve call. Vitium checks role, evidence, matching candidate revision and state under Ordo. Any failed verification returns to work without erasing earlier attempts; an independently accepted pass can resolve.

## 6. Known missing functionality

The preview SDK has typed transport and server-acknowledged receipts. It **does not yet provide**:

- A deployed, authenticated Vitium machine API for `/api/v1/observations` or `/api/v1/verification-results`.
- A durable store-and-forward outbox for producer outages. Consumers should not pretend automatic retries are implemented; see issue #14.
- Final authorized Ordo transition processing, downstream Praxis remediation callbacks and Fides machine identity integration.
- Packaging qualification by Conditor or a published NuGet release artifact.

These are separately tracked in [issue #14](https://github.com/kemiller2002/vitium/issues/14) and [issue #15](https://github.com/kemiller2002/vitium/issues/15). Keep project and product state documents honest about these boundaries.
