# Vitium

Vitium is Echelon Foundry's cross-repository defect reporting and quality intelligence application.

**Canonical site:** https://vitium.echelonfoundry.com/

## Product requirements

Vitium's **proposed end-to-end product baseline** is [docs/requirements/VITIUM-REQUIREMENTS.md](docs/requirements/VITIUM-REQUIREMENTS.md), with [36 acceptance scenarios](docs/requirements/VITIUM-ACCEPTANCE.md) and [open product/architecture decisions](docs/requirements/VITIUM-OPEN-DECISIONS.md). The baseline currently contains 92 scoped requirements across reporting, domain records, secure intake, lifecycle, Echelon integration, independent verification, operations and governance.

**Status:** Proposed, not approved or fully implemented. Decisions and production acceptance evidence remain outstanding. See [current state](context/CURRENT-STATE.md). Related tracked implementation issues include #1–#15.

### Automated Echelon defect reporting

The reporting/verification contract for Praxis, Ordo, Conditor, Dokimos, Tutela, Aegis and CI is [the build-system reporting specification](docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md). It requires scoped machine identity, versioned observations, evidence, duplicate protection, and failed-test rework loops. The dedicated implementation work is tracked in issues [#14](https://github.com/kemiller2002/vitium/issues/14) and [#15](https://github.com/kemiller2002/vitium/issues/15). The machine intake adapter is **not deployed**.

## Report a defect

The first delivery is a public, accessible report form in `site/`. It collects a structured report, lets the reporter review it, and opens a prefilled GitHub Issue for the reporter to submit.

**Current limitation:** GitHub account sign-in is required to finish submission, and submitted reports in this public repository are public. The page does **not** directly store or transmit reports and does not support attachments.

The canonical publishing address is **https://vitium.echelonfoundry.com/**. Hosting currently targets GitHub Pages via `.github/workflows/pages.yml`. Configuration of the GitHub Pages custom domain, DNS, and enforced HTTPS must be verified independently; see [DEPLOYMENT.md](DEPLOYMENT.md).

## NuGet packages for Echelon build systems

Two F# preview libraries now live in `src/`: `EchelonFoundry.Vitium.Contracts` and `EchelonFoundry.Vitium.Client`. They compile into versioned NuGet artifacts via [the package CI workflow](.github/workflows/nuget-ci.yml). [Package setup, local build, trusted publishing and Praxis integration instructions](docs/NUGET-PACKAGES.md) explain how to use them.

**Not yet published or operational:** GitHub Actions builds and packs candidate artifacts but does not publish to NuGet.org. The machine reporting API does not exist as a deployed service. A guarded manual publication workflow requires an owner-approved distribution/license decision, an approved GitHub environment, a matching release tag and NuGet Trusted Publishing configuration.

## Engineering governance

Vitium follows the Echelon engineering stack. Conditor is the authority for installing and upgrading repository lifecycle capabilities; its manifest is `conditor.json`. **The manifest declares the target state. No Conditor installation or successful verification has been demonstrated here.** Do not create `.conditor/lock.json` or tool-owned files by hand.

See [governance and staged migration](docs/GOVERNANCE.md), [current state](context/CURRENT-STATE.md), and [domain and deployment setup](DEPLOYMENT.md).

## P0 private-intake implementation candidate

The repository now contains a **feature-gated private intake flow**:
- `site/public-config.mjs` disables direct private submission until the API and public anti-bot site key are verified.
- `service/` implements strict versioned input validation, a private observation, Turnstile verification, optimistic/idempotent durable receipt creation, and an AWS Lambda adapter.
- `service/triage-cli.mjs` provides a provisional AWS IAM-authorized internal review path; it is not a public endpoint.
- `infra/aws/template.yaml` provides a guarded AWS SAM staging candidate. It has **not been deployed**.

The existing GitHub issue handoff remains the only presently usable submission path. Do not represent the private service as live or production approved. See [P0 implementation audit](docs/P0-IMPLEMENTATION.md), [intake infrastructure runbook](infra/aws/README.md), and [P0 acceptance requirements](docs/requirements/VITIUM-ACCEPTANCE.md).

## Development

```bash
npm test
python3 -m http.server --directory site 8000
```

Open http://localhost:8000 and select **Report a defect**.

## Architectural boundaries

- **Forma:** pinned presentation assets; the app owns form state and domain logic.
- **Vitium:** defect schema, reporting experience, triage, correlation and lifecycle.
- **GitHub Issues:** initial durable issue store; Vitium reports are public at this stage.
- **Arca:** eventual provider-neutral persistence layer for internal records.
- **Fides:** workforce authentication when the protected API is implemented.
- **Dokimos / Praxis / Ordo:** evidence, remediation and engineering decisions.

**Public, GitHub-free intake is NOT yet implemented.** It requires a server-side submission boundary, rate limiting, spam controls, moderation, and a GitHub App with minimum scoped credentials. Never put repository or application secrets in GitHub Pages assets.

See [reporting architecture](docs/REPORTING.md) and [defect schema](schemas/defect.schema.json).
