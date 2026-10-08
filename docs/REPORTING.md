# Public defect reporting

## Current release: browser form + explicit GitHub handoff

The `site/` reporting interface is public and needs no GitHub credentials while the visitor fills in and reviews the draft. **It does not submit anything itself.** On **Continue to GitHub**, it opens a prefilled GitHub issue in `kemiller2002/vitium`. The visitor signs in, reviews the public issue, and completes submission there. The browser does not store the draft.

This first release deliberately uses GitHub as a public intake queue and **does not grant any external reporter access to internal application repositories**. Triagers may link the public report to a private implementation issue without copying customer data into public places. Public reporters should never be promised access to internal resolution details.

A GitHub account is currently required for submission. A truly GitHub-free reporting experience is a **separate, unimplemented** increment and should not be marketed as available.

## Requirements

| ID | Requirement |
|---|---|
| VIT-REP-001 | A person can report a defect without understanding developer terminology. |
| VIT-REP-002 | Require product, short summary, actual behavior, expected behavior, impact and privacy acknowledgement. |
| VIT-REP-003 | Reproduction steps and page URL are optional. |
| VIT-REP-004 | The user reviews the complete report before navigating to GitHub. The UI must not claim submission before GitHub confirms. |
| VIT-REP-005 | Client-side normalization is deterministic and testable without DOM or network. |
| VIT-REP-006 | Preserve multiline steps, trim whitespace, enforce length limits, and never silently truncate data. |
| VIT-REP-007 | Strip URL user-info, query strings and fragments. Reject non-HTTP protocols. |
| VIT-REP-008 | Accessible native inputs, real labels, focus management, keyboard usage, mobile 320px baseline, error announcement and reduced-motion support. |
| VIT-REP-009 | No GitHub token, GitHub App credential or other secret may enter static frontend assets. |
| VIT-REP-010 | All published public reports must be clearly disclosed as public and require an explicit confirmation that secrets were excluded. |
| VIT-REP-011 | Use pinned Forma presentation, not a copied or drifting stylesheet; domain behavior remains in Vitium. |
| VIT-REP-012 | Model the report so later server-side ingestion can map to the canonical defect schema without changing the user questions. |

## Public-intake threat model

- **Confidentiality:** GitHub issues in Vitium are public. The initial submission link also contains report content in its query string; this may appear in browser history and provider logs. The form must tell reporters not to provide private data. Restrict public use to non-sensitive reports.
- **URL secrets:** Strip URL credentials, query strings and fragments before formatting. No automatic capture of page URL, cookies, local storage, application state, session tokens, telemetry, fingerprint or browser history.
- **Injection:** Treat report text as untrusted, use `textContent` rather than `innerHTML`, and do not turn markdown report bodies into executable instructions. Do not execute reporters' code, URLs or reproduction scripts.
- **Availability:** Input lengths and encoded GitHub link length are bounded with actionable validation errors.
- **Abuse:** Public GitHub issue creation uses GitHub's existing abuse protections. Do not directly open public unauthenticated write endpoints without server-side controls.

## Second increment: direct submission without GitHub

Implement a server-side **Vitium Intake API**, independent of Fides login. This is necessary because Fides currently authenticates via GitHub. GitHub sign-in cannot be required of customers who do not have GitHub accounts.

Proposed flow:

1. Public site sends `POST /api/reports` to a narrow server-side API over HTTPS with a versioned validated report, size caps and anti-bot challenge.
2. API applies rate limiting by client/risk, payload size limits, abuse filtering, deduplication policy and quarantine/moderation. Retain minimal abuse metadata for a defined retention period.
3. API stores a private intake record (eventually via Arca, initially through a narrow adapter) and issues an opaque public receipt/reference ID. It must not leak private repository issue numbers or authentication details.
4. Worker, with a minimally scoped GitHub App installation token held server-side, creates or links an internal GitHub Issue after policy permits it. Failures should retry safely with idempotency keys.
5. Reporter can check status by opaque receipt, where approved, without exposing internal findings. Do not build a public issue listing backed by confidential data.
6. Accept file attachments only after an approved scan/redaction/retention design. No uploads in the current form.

Authentication for maintainers comes later through Fides; it is **not** a prerequisite for anonymous public intake. Anonymous reporting remains abuse-prone and requires operational controls and an explicit moderation owner.

## Triage model

Capture product, expected/actual behavior, reproduction, impact, sanitized URL, source, timestamps and evidence links. Internal triage assigns priority and severity; do **not** ask casual reporters to assign a P0/P1 priority. Add private issue links, duplicate clusters, test evidence, regression proof, root cause and prevention actions in the internal case.

`schemas/defect.schema.json` is the internal canonical contract, not a claim that ingestion/persistence has shipped.

## Running locally

```bash
npm test
python3 -m http.server --directory site 8000
```

Open `http://localhost:8000`. The module system requires an HTTP server rather than opening `index.html` from disk.

## Deployment

GitHub Pages workflow publishes `site/` on updates to `main`. Enable **Settings → Pages → Source: GitHub Actions** in Vitium. The canonical public URL is **https://vitium.echelonfoundry.com/**. GitHub Pages must be enabled for Actions and configured with that custom domain; DNS and HTTPS need separate operator verification. See `DEPLOYMENT.md`. The GitHub Pages default origin must not be given to end users as the product address.

Do not add production endpoint URLs, keys or tokens to the frontend until the intake API has a reviewed security contract.
