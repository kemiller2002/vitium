# Operator decision and action register

Requirements: VIT-NFR-003/004/005, VIT-API-006/007 · Issues #7, #13 · Mission VIT-P0-2026-10-08
Every row is **OPEN** unless its evidence column contains a recorded, witnessed artifact. Agents may not close rows. Only the named operator can, by recording the evidence.

| ID | Action / decision | Owner | Exact command or setting | Evidence that closes it | Acceptance IDs | Open decisions |
|---|---|---|---|---|---|---|
| D-01 | Verify `echelonfoundry.com` with GitHub Pages | UNASSIGNED | Account Settings → Pages → Add verified domain; create TXT `_github-pages-challenge-kemiller2002.echelonfoundry.com` | `dig +short TXT _github-pages-challenge-kemiller2002.echelonfoundry.com` non-empty, plus "Verified" in settings (witnessed absent 2026-10-08T12:59:25Z) | VIT-AC-014 | — |
| D-02 | Enable Pages with source **GitHub Actions** | UNASSIGNED | Repo Settings → Pages → Source: GitHub Actions | `gh api repos/kemiller2002/vitium/pages --jq .build_type` = `workflow` (witnessed `has_pages:false` 2026-10-08T12:32:36Z) | VIT-AC-014 | — |
| D-03 | Set the Pages custom domain | UNASSIGNED | Repo Settings → Pages → Custom domain `vitium.echelonfoundry.com` | Pages API `.cname` = `vitium.echelonfoundry.com` | VIT-AC-014 | — |
| D-04 | DNS CNAME | UNASSIGNED (DNS at domaincontrol.com) | `vitium` CNAME `kemiller2002.github.io.`, with no other records for `vitium` | `dig +short CNAME vitium.echelonfoundry.com` = `kemiller2002.github.io.` (witnessed NXDOMAIN 2026-10-08T12:47:43Z) | VIT-AC-014 | — |
| D-05 | Enforce HTTPS | UNASSIGNED | Repo Settings → Pages → Enforce HTTPS | Pages API `.https_enforced` = true; `openssl s_client` cert SAN covers the host; `verify-public-site.mjs` exit 0 | VIT-AC-014 | — |
| D-06 | First genuine Pages deploy | UNASSIGNED | Run "Vitium public site" on `main` | A run URL where all 4 jobs (`test`, `build`, `deploy`, `verify-canonical`) are green, plus the commit SHA | VIT-AC-014, VIT-AC-015 | VIT-OQ-018 |
| D-07 | AWS account(s) for staging and production; separate production account | UNASSIGNED | Organizations/account creation (outside repo) | Account IDs recorded privately; approver named | VIT-AC-003..009 | VIT-OQ-003, VIT-OQ-004 |
| D-08 | AWS region / data location | UNASSIGNED | Choice recorded | Region and rationale recorded | VIT-AC-028 | VIT-OQ-009 |
| D-09 | Budget approval and alarm | UNASSIGNED | `aws budgets create-budget` with the approved amount and alert recipient | Budget ID and amount recorded. **Amount is not decided.** | — | VIT-OQ-018 |
| D-10 | Cloudflare Turnstile widgets (staging, production) | UNASSIGNED (Cloudflare account owner) | Cloudflare dashboard → Turnstile → widget for each hostname, action `vitium-intake` | Site key recorded (public). Secret stored only in Secrets Manager (ARN recorded). | VIT-AC-005 | — |
| D-11 | Secrets Manager entry and rotation owner | UNASSIGNED | `aws secretsmanager create-secret --name vitium/<env>/turnstile-secret` | ARN recorded; rotation procedure owner named | VIT-AC-015 | — |
| D-12 | RPO/RTO | UNASSIGNED | Decision informed by the staging drill (ROLLBACK-AND-DR.md §5) | Approved values plus measured drill evidence | VIT-AC-027 | VIT-OQ-018 |
| D-13 | Moderation/triage owner and backup | UNASSIGNED | Named people | Names recorded in INCIDENT-AND-ESCALATION.md | VIT-AC-008, VIT-AC-011 | VIT-OQ-008 |
| D-14 | Security contact and private channel | UNASSIGNED | `SECURITY.md` and/or GitHub private vulnerability reporting enabled | Channel tested with a synthetic report | VIT-AC-008 | VIT-OQ-008 |
| D-15 | Retention and deletion periods | UNASSIGNED | Values in DATA-HANDLING.md §2, then TTL handoff H-06 | Approved table, TTL deployed and verified | VIT-AC-028 | VIT-OQ-009 |
| D-16 | Privacy notice | UNASSIGNED | Published notice text, linked from the site | Notice URL live; text reviewed by the privacy owner | VIT-AC-003, VIT-AC-008 | VIT-OQ-006, VIT-OQ-009 |
| D-17 | Data-subject request process | UNASSIGNED | DATA-HANDLING.md §3 completed | Synthetic DSR executed end-to-end in staging | VIT-AC-028 | VIT-OQ-005, VIT-OQ-009 |
| D-18 | Staging deploy authorization | UNASSIGNED | STAGING-READINESS.md commands | Stack ID, change set and E1–E14 results recorded | VIT-AC-003..009, VIT-AC-015 | VIT-OQ-003 |
| D-19 | Intake custom domain | UNASSIGNED | ACM cert + API Gateway custom domain + `intake` DNS record | `curl -sSI https://intake.vitium.echelonfoundry.com/api/v1/reports` shows the expected 403/404 from the API; cert valid (witnessed NXDOMAIN 2026-10-08T12:33:28Z) | VIT-AC-003 | VIT-OQ-003 |
| D-20 | Enable private intake in the public config | UNASSIGNED; requires D-05..D-19 | `site/public-config.mjs` `enabled: true`, plus endpoint and site key | **Blocked by tests by design.** Requires an explicit approved change to tests/secret-scan.test.mjs and tests/p0-contract.test.mjs with recorded approval. | VIT-AC-003 | VIT-OQ-007, VIT-OQ-018 |
| D-21 | Per-client abuse control (WAF/CloudFront) | UNASSIGNED | Architecture decision (handoff H-02) | Decision record plus a staging burst test | VIT-AC-005 | VIT-OQ-003 |
| D-22 | `github-pages` environment protection | UNASSIGNED | Repo Settings → Environments → `github-pages` → deployment branches: `main` only; optional required reviewer | Screenshot or `gh api repos/kemiller2002/vitium/environments/github-pages` | VIT-AC-014 | — |
| D-23 | Continuous site monitoring and alert route | UNASSIGNED | Scheduled `verify-public-site.mjs` workflow once an alert destination exists | Workflow and alert route recorded | VIT-AC-014 | VIT-OQ-016 |

Order of operations for the public site: D-01 → D-02 → D-03 → D-04 → D-05 → D-22 → D-06.
Order for private intake: D-07/D-08/D-09 → D-10/D-11 → D-13/D-14/D-15/D-16/D-17 → D-18 → D-19 → D-21 → D-20.
