# UX-0001: Forma version pin and stylesheet integrity

- **Status:** provisional (agent decision, reversible). Needs owner review.
- **Date:** 2026-10-08
- **Mission:** VIT-P0-2026-10-08, Phase E, branch `p0/forma-ux`
- **Requirements:** VIT-REP-011 (pinned Forma, no fork), VIT-UX-006, VIT-AC-015

## Context

`site/index.html` loads `https://cdn.jsdelivr.net/npm/@echelon-foundry/design-system@0.3.0/dist/all.css` with no `integrity` attribute. Forma's own consumption guide (`docs/CONSUMING-FORMA.md`, read from a fresh clone at `85497f0`) still names 0.3.0 as the application baseline. Its changelog lists 0.4.1 (2026-10-06) as a patch release with no markup, class or token changes. 0.4.1 fixes WCAG AA contrast on secondary surfaces, a forced-colors bug and a broken built rule in 0.3.0.

## Evidence gathered (commands run from the scratchpad)

| Check | Result |
|---|---|
| npm registry metadata for `@echelon-foundry/design-system` | Versions 0.3.0 and 0.4.1 exist. `latest` is 0.4.1. Both have npm `attestations` entries. 0.3.0 integrity is `sha512-MqWmK+jBMGzx…UoNI1w==`. |
| Downloaded the npm 0.3.0 tarball and hashed it with `openssl dgst -sha512` | The hash matches the registry `integrity`. |
| SRI of `package/dist/all.css` in the npm 0.3.0 tarball | `sha384-x9anozrofwM8enraqashpXIdJQ34xZooZK7aMtefWmePvNl2K0kBZQg0TA6qWcYt` |
| Fetched the same file from cdn.jsdelivr.net (and unpkg.com) | **Blocked** in this environment (proxy 403). I could not confirm that the CDN serves bytes identical to the npm tarball. |
| GitHub release asset `v0.3.0/echelon-foundry-design-system-0.3.0.tgz` | Downloads, but **differs from the npm 0.3.0 tarball** (`dist/all.css`, `components.css`, `foundations.css` and others differ; the npm build adds motion transitions). Two different artifacts are published under the same version number. |
| GitHub release `v0.4.1` tarball vs npm 0.4.1 tarball | **Byte-identical** (sha256 `32685421…72ed76`). The npm integrity matches. |
| SRI of `package/dist/all.css` in 0.4.1 | `sha384-uQpeYSVYVzO0mq6h6g1AmG0sRLo/z1UnyT8H8GyJ57M7QkBl9OHoESbtyNm4/KhY` |
| npm provenance (Sigstore) verification | Not possible here. Sigstore TUF is blocked and `gh attestation verify` does not work. |

## Decision

1. **Keep Forma 0.3.0** on the exact-version CDN URL. 0.4.1 has a consistent, integrity-matching artifact across npm and GitHub, but its provenance could not be cryptographically verified here, and the CDN copy cannot be compared. Upgrading is an explicit dependency change under Forma's own upgrade rule. That rule requires the application's browser and accessibility tests, which belong to the verification agent and have not run yet.
2. **Do not add an `integrity` attribute yet.** For 0.3.0, the two upstream artifacts disagree and the CDN bytes cannot be fetched to confirm which one jsDelivr serves. A wrong SRI hash blocks the stylesheet completely: the page would become unstyled for every visitor, and I could not test that outcome here. That risk is worse than the current gap.
3. Record this as an open gap (below) instead of guessing.

## Consequences and next actions (operator or verification agent)

- **Gap UX-G1:** From a network that can reach jsDelivr, run `curl -sSLf https://cdn.jsdelivr.net/npm/@echelon-foundry/design-system@0.3.0/dist/all.css | openssl dgst -sha384 -binary | base64`. If it equals `x9anozro…WcYt` (the npm artifact), add `integrity="sha384-x9anozrofwM8enraqashpXIdJQ34xZooZK7aMtefWmePvNl2K0kBZQg0TA6qWcYt" crossorigin="anonymous"` to the link. If it differs, stop and report to Forma: the two 0.3.0 artifacts are already inconsistent.
- **Gap UX-G2 (recommended upgrade):** Move to 0.4.1. Use the `sha384-uQpeYSVY…KhY` SRI after the same CDN byte check, then run the Playwright and axe suite at 320px, 375px and desktop. A safer alternative that avoids the CDN entirely is to vendor the verified tarball's `all.css` through a pinned install step (Forma's `actions/install-presentation` and `forma.lock` path for websites). That is a build and workflow change outside this agent's ownership.
- **Upstream defect (Forma):** The 0.3.0 GitHub release tarball and the npm 0.3.0 tarball differ in content. Report it to Forma with the sha256 values above: GitHub `df0c1619…78be5`, npm `34f38e10…921683`.
- A stylesheet failure leaves native HTML controls usable, because every control is a native element with a real label. No extra fallback notice was added. A CSS-dependent notice could not be tested without a browser, and it would add copy that never shows in the common case.
