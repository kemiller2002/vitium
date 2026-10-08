# Vitium

Vitium is Echelon Foundry's cross-repository defect reporting and quality intelligence application.

## Report a defect

The first delivery is a public, accessible report form in `site/`. It collects a structured report, lets the reporter review it, and opens a prefilled GitHub Issue for the reporter to submit.

**Current limitation:** GitHub account sign-in is required to finish submission, and submitted reports in this public repository are public. The page does **not** directly store or transmit reports and does not support attachments.

For the immediate reporter interface, enable GitHub Pages at **Settings → Pages → Build and deployment → GitHub Actions**. The workflow `.github/workflows/pages.yml` deploys `site/` after it is added.

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
