# Vitium deployment

**Canonical production URL:** https://vitium.echelonfoundry.com/

**Host:** GitHub Pages via the Vitium GitHub Actions workflow (`.github/workflows/pages.yml`). Domain is declared in the page's canonical/OG metadata. Declaring the hostname **does not configure DNS, HTTPS or GitHub Pages settings**.

## Current witnessed state (2026-10-08, read-only)

- `gh api repos/kemiller2002/vitium` → `has_pages: false` (12:32:36Z). All five recorded `pages.yml` runs failed at `actions/configure-pages` with `Get Pages site failed … Not Found`; upload and deploy were skipped (latest: run 37771094723).
- `vitium.echelonfoundry.com` and `intake.vitium.echelonfoundry.com` returned **NXDOMAIN** (12:33:28Z, 12:47:43Z). The domain is **not** verified for GitHub Pages: there is no `_github-pages-challenge-kemiller2002` TXT record (12:59:25Z).
- HTTPS could not be observed from the agent sandbox because the egress proxy denied the connection. That result is not evidence about the site.
- **The site is not live.** The full record, exact operator steps and the evidence checklist are in [docs/operations/PAGES-DNS-TLS.md](docs/operations/PAGES-DNS-TLS.md). Every outstanding operator action is listed in [docs/operations/OPERATOR-DECISIONS.md](docs/operations/OPERATOR-DECISIONS.md).

## Pipeline semantics (fail closed)

`.github/workflows/pages.yml` runs `test → build → deploy → verify-canonical` ([OPS-001](docs/decisions/OPS-001-pages-pipeline-fail-closed.md)). A run counts as a deployment **only if all four jobs are green**. `verify-canonical` runs `node scripts/verify-public-site.mjs` against the canonical URL, so an uploaded artifact that is not served over trusted HTTPS at the canonical origin is a failed run. Actions are pinned to commit SHAs, and only the `deploy` job holds `pages: write` / `id-token: write`.

## Required operator configuration

Recommended first step: verify `echelonfoundry.com` under account Settings → Pages → Verified domains, so that `vitium` cannot be taken over by another Pages site. See PAGES-DNS-TLS.md step 1.

1. In [Vitium GitHub Pages settings](https://github.com/kemiller2002/vitium/settings/pages), choose **Build and deployment → GitHub Actions**.
2. Under **Custom domain**, enter `vitium.echelonfoundry.com` and save. Verify ownership of `echelonfoundry.com` in GitHub Pages settings if not yet done (recommended).
3. At the DNS provider for `echelonfoundry.com`, create an exact **CNAME** record:
   - Host/name: `vitium`
   - Type: `CNAME`
   - Target/value: `kemiller2002.github.io` (do not append `/vitium`).
   - Keep DNS without wildcard aliases for this application; do not include extra `A`/other conflicting records for `vitium`.
4. Once GitHub has issued the TLS certificate, select **Enforce HTTPS** in Pages settings. Do not route user reports to an HTTP-only endpoint.
5. Deploy `main` through the Pages workflow, observe an actual successful quality-test run and deployment, confirm DNS, HTTPS, the canonical origin and all assets using a browser.
6. Verify the source repository's custom domain binding remains stable before directing reporters to it. Test keyboard-only form completion and the GitHub submission handoff separately; a deploy does not prove they work.

Check DNS with:

```sh
dig +short CNAME vitium.echelonfoundry.com
# Expect: kemiller2002.github.io.
node scripts/verify-public-site.mjs   # read-only; exit 0 required, otherwise a typed reason
```

The browser must show a trusted TLS certificate for `vitium.echelonfoundry.com`, and `https://vitium.echelonfoundry.com/` must load the reporter. GitHub's default repository URL is a transport detail, not the public product address.

### Do not commit a fake CNAME mechanism

GitHub documents that when publishing via a **custom GitHub Actions workflow**, any CNAME file in the deployed artifact is ignored and is **not required**. The controlling configuration is the Pages **Custom domain** setting plus DNS. Do not treat a `site/CNAME` file as a substitute. Reference: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

## Release and governance gates

Before turning on the production custom domain for users:

- Run `conditor plan`, `conditor init`, `conditor verify` and `conditor doctor` with the declared manifest on a real checkout. Review changes and commit tool-produced immutable provenance and locks. No one may synthesize these receipts by hand.
- Verify Praxis and Ordo, including real evidence/provenance and bounded work items, after Conditor installs them.
- Pin and verify Forma/Limen/Folio/Aegis application bindings through Conditor's supported scaffold or the approved migration contract. The original `site/` frontend is a stopgap, **not** a claim of full Echelon-stack conformity.
- Do not deploy a security-sensitive anonymous intake backend to static GitHub Pages. The first version sends users to GitHub's authenticated issue creation. Future public API must have its own security design and service deployment.
- Confirm all tests including browser/accessibility verification, release integrity and dependency pinning before production acceptance.
- Report actual gate states and external operator actions in `context/CURRENT-STATE.md`.

## What remains outside repository automation

This repository's GitHub content API does **not** manage DNS or the Pages custom-domain setting. Both require operator configuration through their respective control planes. Neither action has been performed or verified by committing source changes.
