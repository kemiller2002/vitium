# Vitium current state

Date: 2026-10-08

**Canonical domain:** https://vitium.echelonfoundry.com/ (configured in source; DNS/Pages/HTTPS not verified).

## Implemented in the repository

- Public, responsive, two-step reporting form in `site/index.html`.
- Deterministic validation, normalization, sanitized page URL and GitHub issue prefill in `site/submission.mjs`.
- Review-before-GitHub step; form explicitly states that submission happens on GitHub.
- Pinned Forma 0.3.0 CSS consumption via CDN.
- A versioned internal defect JSON Schema.
- Node unit tests for the report normalization/link contract.
- GitHub Actions files for CI tests and GitHub Pages deployment.
- Conditor lifecycle manifest declared, not installed or verified.
- Echelon governance and migration contract documented.

## Not confirmed or not implemented

- GitHub Pages Settings must configure custom domain `vitium.echelonfoundry.com` and GitHub Actions as source. DNS CNAME and HTTPS still require setup/verification.
- Conditor needs a real tool-run installation and verified lock; no lifecycle installation is evidenced.
- Forma 0.3.0 CSS in the current frontend has not yet been proved a valid pinned deployed asset or upgraded to the Echelon 0.4.1 target. The JavaScript form must migrate to the Conditor-managed F#/Limen application baseline.
- CI and deployment have not been verified as successful.
- Browser automation, axe a11y verification and screenshots are not yet executed.
- Direct submission without GitHub (issue #1).
- Full browser and assistive-tech verification (issue #2).
- Maintainer triage application (issue #3).
- Safe attachments (issue #4).
- Arca storage, Fides internal login, Dokimos intake, Praxis remediation and Ordo lifecycle integration.

## Immediate next action

Execute and verify Conditor installation from the manifest, follow the scaffold migration plan in `docs/GOVERNANCE.md`, configure `vitium.echelonfoundry.com` per `DEPLOYMENT.md`, and pass all tests before calling the site live. For reporting without GitHub accounts, implement issue #1 first.
