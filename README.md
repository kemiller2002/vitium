# Vitium

Vitium is Echelon Foundry's cross-repository defect reporting and quality intelligence application.

**Canonical site:** https://vitium.echelonfoundry.com/

## Product requirements

Vitium's **proposed end-to-end product baseline** is [docs/requirements/VITIUM-REQUIREMENTS.md](docs/requirements/VITIUM-REQUIREMENTS.md), with [31 acceptance scenarios](docs/requirements/VITIUM-ACCEPTANCE.md) and [open product/architecture decisions](docs/requirements/VITIUM-OPEN-DECISIONS.md). The baseline currently contains 79 scoped requirements across reporting, domain records, secure intake, lifecycle, Echelon integration, independent verification, operations and governance.

**Status:** Proposed, not approved or fully implemented. Decisions and production acceptance evidence remain outstanding. See [current state](context/CURRENT-STATE.md). Related tracked implementation issues are #1–#13.

## Report a defect

The first delivery is a public, accessible report form in `site/`. It collects a structured report, lets the reporter review it, and opens a prefilled GitHub Issue for the reporter to submit.

**Current limitation:** GitHub account sign-in is required to finish submission, and submitted reports in this public repository are public. The page does **not** directly store or transmit reports and does not support attachments.

The canonical publishing address is **https://vitium.echelonfoundry.com/**. Hosting currently targets GitHub Pages via `.github/workflows/pages.yml`. Configuration of the GitHub Pages custom domain, DNS, and enforced HTTPS must be verified independently; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Engineering governance

Vitium follows the Echelon engineering stack. Conditor is the authority for installing and upgrading repository lifecycle capabilities; its manifest is `conditor.json`. **The manifest declares the target state. No Conditor installation or successful verification has been demonstrated here.** Do not create `.conditor/lock.json` or tool-owned files by hand.

See [governance and staged migration](docs/GOVERNANCE.md), [current state](context/CURRENT-STATE.md), and [domain and deployment setup](DEPLOYMENT.md).

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
