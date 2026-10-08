# OPS-001: Pages pipeline fails closed and verifies the canonical site

- Status: **Proposed** (provisional, reversible)
- Date: 2026-10-08
- Requirements: VIT-NFR-003, VIT-NFR-004, VIT-AC-014, VIT-AC-015 · Issue #7

## Context

All five recorded runs of `pages.yml` failed at `actions/configure-pages` because Pages is not enabled (`has_pages: false`). The old single-job workflow held `pages: write` and `id-token: write` for every step, including `npm test`. It also referenced actions by mutable tags, and a green run would have meant only "artifact uploaded", not "site served at the canonical HTTPS origin".

## Decision

1. Split the workflow into `test → build → deploy → verify-canonical`. Workflow-level `permissions: {}`; only `deploy` gets `pages: write` and `id-token: write`.
2. Do not use `enablement: true` and do not add a PAT. Enabling Pages remains an operator action (OPERATOR-DECISIONS D-02).
3. Add a post-deploy, read-only `scripts/verify-public-site.mjs` job, so a run is green only when DNS, TLS, canonical, assets and secret-absence are witnessed.
4. Pin actions to full commit SHAs, resolved with `git ls-remote` on 2026-10-08 and recorded in the commit message. Upgrades require re-resolving and reviewing.
5. Set `cancel-in-progress: false` so an in-flight deployment is never interrupted.

## Consequences

- Until D-01..D-05 are done, every Pages run fails at `build` (configure-pages) or `verify-canonical` (DNS). This is the honest state.
- `verify-canonical` can fail transiently right after a first deploy while the certificate is being issued. Re-run the job; do not weaken it.
- Reversal: revert this commit. No external state was changed.
