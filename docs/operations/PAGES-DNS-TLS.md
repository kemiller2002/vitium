# Runbook: GitHub Pages, DNS and TLS for vitium.echelonfoundry.com

Requirements: VIT-NFR-003, VIT-AC-014, VIT-AC-015 · Issue #7 · Owner: **UNASSIGNED (repository/DNS operator)**

This runbook covers operator-only actions. Repository automation cannot perform them, and committing source does not perform them either. Do not call the site "live" until every item in [Evidence to record](#evidence-to-record) has been witnessed and recorded.

## Witnessed state on 2026-10-08 (release-ops agent, read-only)

| Check (UTC) | Result |
|---|---|
| 12:32:24 `gh api repos/kemiller2002/vitium/pages` | Blocked by the sandbox GitHub proxy (HTTP 403 "Access to this GitHub API path is not permitted through this proxy"). **Not** evidence either way. |
| 12:32:36 `gh api repos/kemiller2002/vitium --jq .has_pages` | `false`. Pages is not enabled. |
| 12:32:46 latest `pages.yml` run [37771094723](https://github.com/kemiller2002/vitium/actions/runs/37771094723) (`6e7b1d9`) | `failure`. Steps: checkout ✓, setup-node ✓, `npm test` ✓, `configure-pages@v5` ✗, upload skipped, deploy skipped. Annotation: `Get Pages site failed. Please verify that the repository has Pages enabled and configured to build using GitHub Actions … Error: Not Found`. All 5 recorded `pages.yml` runs failed. |
| 12:33:28 / 12:47:43 system DNS (8.8.8.8) `vitium.echelonfoundry.com` CNAME/A/AAAA/TXT | `ENOTFOUND` (NXDOMAIN). **No record exists.** |
| 12:33:28 `intake.vitium.echelonfoundry.com` | `ENOTFOUND`. |
| 12:47:43 `echelonfoundry.com` A | `185.199.108–111.153` (GitHub Pages anycast). NS `ns07/ns08.domaincontrol.com`. SOA serial `2026100600`. |
| 12:47:43 `www.echelonfoundry.com` CNAME | `kemiller2002.github.io` |
| 12:59:25 `_github-pages-challenge-kemiller2002.echelonfoundry.com` TXT | `ENOTFOUND`. **The domain is not verified with GitHub Pages.** |
| 12:59:25 `echelonfoundry.com` CAA | `ENODATA` (no CAA, so any CA may issue; Let's Encrypt is not blocked). |
| 12:34:00 `curl -sSI https://vitium.echelonfoundry.com/` | `CONNECT tunnel failed, response 403`. The sandbox egress proxy refused the connection, so this result says nothing about the site. |
| 12:53:02 `node scripts/verify-public-site.mjs` | `FAIL dns-cname DNS_NXDOMAIN`, exit 10. |

Unverified inference: the apex and `www` already point at GitHub Pages, so the account's user site probably uses `echelonfoundry.com` as its custom domain. If that holds, `https://kemiller2002.github.io/vitium/` redirects under the apex until Vitium gets its own custom domain. Confirm this from a normal network before relying on it.

## Operator steps (in this order)

Ordering matters for subdomain-takeover safety. Verify the domain and bind the custom domain in GitHub **before** publishing the DNS CNAME.

1. **Verify the domain with GitHub (recommended, prevents takeover).** Go to GitHub → Settings (account) → Pages → *Add a verified domain* → `echelonfoundry.com`. GitHub shows a TXT record:
   - Name: `_github-pages-challenge-kemiller2002` (under `echelonfoundry.com`)
   - Value: the one-time code GitHub displays (do not commit it)

   Create it at the DNS provider (GoDaddy/domaincontrol per NS), wait for propagation, then click *Verify*.
2. **Enable Pages with source "GitHub Actions".** Repository → Settings → Pages → *Build and deployment* → Source: **GitHub Actions**. Do not add a PAT or `enablement: true` to the workflow. Enabling Pages is an operator action.
3. **Set the custom domain.** In the same page, set *Custom domain* = `vitium.echelonfoundry.com` → Save. Do not add `site/CNAME`, because GitHub ignores it for Actions-based publishing.
4. **Create DNS.** At the `echelonfoundry.com` DNS provider:
   - `vitium` CNAME `kemiller2002.github.io.` (no path, no `/vitium`)
   - No A/AAAA/ALIAS/wildcard records for `vitium`.
5. **Wait for the DNS check and certificate.** Pages settings shows "DNS check successful" and then provisions a certificate (Let's Encrypt).
6. **Enforce HTTPS.** Tick *Enforce HTTPS* once it becomes available.
7. **Deploy.** Run the `Vitium public site` workflow (push to `main` touching `site/**`, or *Run workflow*). The run counts only if **all four jobs** (`test`, `build`, `deploy`, `verify-canonical`) succeed.
8. **Verify independently** from a workstation (not the CI runner), using the commands below.
9. **Browser check.** Load the site in a real browser, confirm the padlock and certificate subject, complete the form with the keyboard only, and confirm the GitHub handoff opens without auto-submitting.

## Verification commands (all read-only)

```sh
date -u +%FT%TZ
dig +short CNAME vitium.echelonfoundry.com          # expect: kemiller2002.github.io.
dig +short A vitium.echelonfoundry.com              # expect: GitHub Pages addresses via the CNAME
dig +short TXT _github-pages-challenge-kemiller2002.echelonfoundry.com   # expect: present until verified
curl -sSI https://vitium.echelonfoundry.com/         # expect: HTTP/2 200, no Location to github.io
curl -sSI http://vitium.echelonfoundry.com/          # expect: 301 to https://vitium.echelonfoundry.com/ once HTTPS is enforced
openssl s_client -connect vitium.echelonfoundry.com:443 -servername vitium.echelonfoundry.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
node scripts/verify-public-site.mjs --json           # exit 0 required; non-zero exit = typed reason
gh api repos/kemiller2002/vitium/pages --jq '{status, cname, https_enforced, build_type, html_url}'
gh api repos/kemiller2002/vitium/pages/health        # DNS/HTTPS health as GitHub sees it
```

`scripts/verify-public-site.mjs` exit codes: 0 pass · 10 DNS_NXDOMAIN · 11 DNS_LOOKUP_FAILED · 12 DNS_WRONG_TARGET · 19 NETWORK_BLOCKED · 20 HTTPS_UNREACHABLE · 21 TLS_INVALID · 22 HTTP_STATUS · 23 REDIRECT_OFFSITE · 30 CANONICAL_MISSING · 31 CANONICAL_MISMATCH · 32 GITHUB_IO_REFERENCE · 40 ASSET_FAILED · 50 SECRET_FOUND. It validates TLS against Node's built-in public CA list and makes direct (non-proxied) connections. A failure caused by restricted egress (19/20) is **not** evidence about the site.

## Evidence to record

Record each item with a UTC timestamp, the operator identity and the source commit, then attach it to issue #7:

1. Pages API output (`status`, `cname`, `https_enforced`, `build_type: workflow`).
2. `dig` output for CNAME and A, showing no conflicting records.
3. Certificate subject/SAN/issuer/validity from `openssl`.
4. URL of a `Vitium public site` run where all 4 jobs are green, plus its commit SHA (it must equal the deployed `main` SHA).
5. Full `verify-public-site.mjs --json` output with `"ok": true`.
6. Browser observation (screenshot optional): padlock, canonical URL and no redirect.
7. Domain-verification status in account Pages settings.

## Monitoring (open)

Continuous monitoring is VIT-NFR-006 (P1) and has no owner yet. Minimum proposal: a scheduled read-only run of `verify-public-site.mjs` whose failures go to an alert route. The alert destination is **UNDECIDED**, so the schedule is not added until an owner exists. See [OPERATOR-DECISIONS.md](OPERATOR-DECISIONS.md).
