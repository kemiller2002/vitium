# Runbook skeleton: incident, vulnerability and private-data escalation

Requirements: VIT-API-007, VIT-NFR-005, VIT-AC-008 · Issue #13
Status: **SKELETON.** Named owners are UNASSIGNED. Until they are assigned, private intake MUST stay disabled (`site/public-config.mjs` `enabled: false`).

## Roles (do not fill with guesses)

| Role | Responsibility | Primary | Backup |
|---|---|---|---|
| Security contact | Receives vulnerability reports and decides embargo and disclosure | UNASSIGNED | UNASSIGNED |
| Privacy/data owner | Decides on exposure of customer data and notification duties | UNASSIGNED | UNASSIGNED |
| Triage/moderation operator | Reviews private observations and quarantines abusive content | UNASSIGNED | UNASSIGNED |
| AWS account operator | Contains incidents in infrastructure: rotate, disable, restore | UNASSIGNED | UNASSIGNED |
| Repository/Pages operator | Rolls back the site and adjusts DNS | UNASSIGNED | UNASSIGNED |

Private contact channel for reporters: **UNDECIDED**. Options include a `SECURITY.md` with a private mailbox and GitHub private vulnerability reporting. Until it is decided, the site must not tell reporters to post vulnerabilities publicly.

## Non-public intake rules (VIT-API-007)

1. A report that may describe a vulnerability or contains private data is **never** auto-published to GitHub Issues. The service has no GitHub write path today; keep it that way.
2. Do not copy report text into public issues, PRs, commit messages, CI logs or chat tools. Refer to it only by its opaque reference.
3. Never run reporter-provided code, links or reproduction scripts.

## Severity triggers (classification only, no SLA invented)

| Class | Example trigger | First action |
|---|---|---|
| SEC-CRED | Credential found in a published asset, log or repository (secret-scan failure on `main`, canary hit) | Revoke and rotate the credential **first**, then remove it from the source. Removal alone is not containment. |
| SEC-VULN | Vulnerability report about Vitium or another Echelon product | Route to the security contact privately and keep it out of public issues |
| PRIV-EXPOSE | Private report data visible publicly (API, logs, Pages) | Feature-gate rollback (ROLLBACK-AND-DR.md §1), then contain and assess |
| ABUSE | Spam or abusive flood | Lower API throttle or disable the route, then moderate |
| AVAIL | Intake unavailable or failing | Verify that no false receipts were issued (VIT-AC-007), then restore |

Response-time targets are **UNDECIDED** (VIT-OQ-008). Do not publish any.

## Containment steps (by asset)

- **Turnstile secret leaked:** rotate it in Cloudflare, `aws secretsmanager put-secret-value` the new value, then force a Lambda cold start by updating the function config. Confirm the old secret fails siteverify.
- **AWS key leaked:** deactivate the key in IAM immediately, review CloudTrail for its use, and rotate it.
- **GitHub token leaked:** revoke it in GitHub settings and review the audit log.
- **Public site serving something wrong:** follow the rollback procedure in ROLLBACK-AND-DR.md.
- **Private intake misbehaving:** set the API stage throttle to 0, or remove the route by deploying with the function's reserved concurrency set to 0: `aws lambda put-function-concurrency --function-name <fn> --reserved-concurrent-executions 0`. Then set `enabled: false` and redeploy Pages.

## Record (per incident)

Record the UTC timeline, detector, affected assets, containment actions with command output, data categories involved, a notification decision with its decision-maker, and follow-up issue links. Keep the record in a private location. **Location UNDECIDED.**
