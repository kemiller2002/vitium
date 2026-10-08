# Vitium current state

Date: 2026-10-08

## Implemented in the repository

- Public, responsive, two-step reporting form in `site/index.html`.
- Deterministic validation, normalization, sanitized page URL and GitHub issue prefill in `site/submission.mjs`.
- Review-before-GitHub step; form explicitly states that submission happens on GitHub.
- Pinned Forma 0.3.0 CSS consumption via CDN.
- A versioned internal defect JSON Schema.
- Node unit tests for the report normalization/link contract.
- GitHub Actions files for CI tests and GitHub Pages deployment.

## Not confirmed or not implemented

- GitHub Pages Settings may still require enabling the Actions deployment source.
- CI and deployment have not been verified as successful.
- Browser automation, axe a11y verification and screenshots are not yet executed.
- Direct submission without GitHub (issue #1).
- Full browser and assistive-tech verification (issue #2).
- Maintainer triage application (issue #3).
- Safe attachments (issue #4).
- Arca storage, Fides internal login, Dokimos intake, Praxis remediation and Ordo lifecycle integration.

## Immediate next action

Enable GitHub Pages source **GitHub Actions**, run the quality-gates workflow and verify the hosted form in a real browser before calling it live. For reporting without GitHub accounts, implement issue #1 first.
