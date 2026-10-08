# Runbook: staging readiness for the SAM intake candidate

Requirements: VIT-API-001..007, VIT-NFR-004/005, VIT-AC-003..009, VIT-AC-015 · Issues #1, #13
Status: **NOT DEPLOYED.** No AWS account, region, secret or approval exists. Nothing here authorizes a deployment.

## Preconditions (each needs a named approver, all currently UNASSIGNED)

| # | Precondition | Decision / evidence that closes it | Ref |
|---|---|---|---|
| S1 | AWS account for staging. It must be separate from any production account, or at least use a staging-only stack name. | Account ID recorded in the issue (not in source); approver named | VIT-OQ-003/004, VIT-NFR-005 |
| S2 | Region (data location) | Region recorded; data-location implications accepted | VIT-OQ-009 |
| S3 | Budget guardrail | AWS Budget with an approved amount and alert recipient. **Amount is not decided.** | [OPERATOR-DECISIONS](OPERATOR-DECISIONS.md) D-09 |
| S4 | Cloudflare Turnstile widget for staging | Site key (public) and secret key created by the Cloudflare account owner. The secret goes **only** into Secrets Manager. | VIT-API-003 |
| S5 | Secrets Manager entry | `aws secretsmanager create-secret --name vitium/staging/turnstile-secret --secret-string file://<local-file-outside-repo>` run by the operator. Only the ARN is recorded. | VIT-NFR-004 |
| S6 | Staging hostname decision (**blocking for browser E2E**, see below) | A staging hostname `https://<label>.vitium.echelonfoundry.com` is chosen, served, and has its own Turnstile widget; or staging E2E is limited to non-browser API tests | H-01, [OPERATOR-DECISIONS](OPERATOR-DECISIONS.md) D-24 |
| S11 | Concurrency quota | `aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions'`. If the quota is 10, deploy with `ReservedConcurrency=0` (H-03). | — |
| S7 | Log retention for staging | Provisional 7 days is in the template; approver confirms for staging | VIT-OQ-009 |
| S8 | Synthetic-data-only rule | Staging receives synthetic reports only and no real customer data until VIT-API-006 is approved | VIT-API-006 |
| S9 | Deploy identity | Least-privilege deployer and CloudFormation execution roles per `infra/aws/README.md` | VIT-NFR-004 |
| S10 | Teardown owner | Named person who deletes the stack **and** the retained table after testing | — |

### S6: staging origin (H-01, intake contract of fix round 1)

The fix-round-1 intake template (branch `p0/fix1-intake`, commit `598ea6c`; not yet on `p0/integration` at the time of writing) takes two parameters:

- `IntakeOrigin`, matching `^https://([a-z0-9-]+\.)?vitium\.echelonfoundry\.com$`
- `ChallengeHostname`, matching `^([a-z0-9-]+\.)?vitium\.echelonfoundry\.com$`

A CloudFormation `Rules` block forces both to the canonical values when `EnvironmentName=production`. Wildcards and other domains are not accepted. **No staging hostname has been chosen** (D-24). Until one is chosen, served and given a Turnstile widget, there are two options:

- **(a) Non-browser only:** run the negative E2E tests (E5, E6, E7, E12) with `Origin: <IntakeOrigin>` against the execute-api URL. Positive tests (E1–E4) need a real Turnstile token for `ChallengeHostname`, which requires a browser page served on that hostname.
- **(b) Full browser E2E:** choose `<label>.vitium.echelonfoundry.com`, serve a staging copy of `site/` there with its own (staging-only) public config, create a Turnstile widget for that hostname, and deploy with the overrides below.

The staging site's public config is a separate artifact. The production `site/public-config.mjs` stays `enabled: false`.

### Body cap

The intake body cap is **24 KiB (24,576 bytes)**, from `service/limits.mjs` `INTAKE_LIMITS.maxBodyBytes`. Bodies above it get 413 `payload_too_large` before decoding and parsing. The cap was raised from 16 KiB because a report with every field at maximum length plus the maximum challenge token measured about 16.6 KB. API Gateway HTTP APIs have a fixed 10 MB ceiling that cannot be lowered, so this application cap is the effective limit.

## Commands (operator only, not executed)

Use a staging-only stack name, `vitium-intake-staging`. Never reuse it for production.

```sh
export AWS_PROFILE=<staging-deployer-profile> AWS_REGION=<APPROVED_REGION>
aws sts get-caller-identity                              # record the ARN (not keys)
sam validate --lint --template-file infra/aws/template.yaml
sam build --template-file infra/aws/template.yaml
node scripts/secret-scan.mjs .aws-sam/build              # must exit 0
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name vitium-intake-staging \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --role-arn <CLOUDFORMATION_EXECUTION_ROLE_ARN> \
  --parameter-overrides EnvironmentName=staging TurnstileSecretArn=<SECRET_ARN> \
      IntakeOrigin=https://<STAGING_LABEL>.vitium.echelonfoundry.com \
      ChallengeHostname=<STAGING_LABEL>.vitium.echelonfoundry.com \
      ReservedConcurrency=<4, or 0 if the account quota is 10> \
      TableDeletionProtection=false \
      PermissionsBoundaryArn=<BOUNDARY_POLICY_ARN or empty> \
  --tags Application=vitium Environment=staging \
  --no-execute-changeset                                 # review the change set first
aws cloudformation describe-change-set --stack-name vitium-intake-staging --change-set-name <NAME>
aws cloudformation execute-change-set  --stack-name vitium-intake-staging --change-set-name <NAME>
aws cloudformation describe-stacks --stack-name vitium-intake-staging --query 'Stacks[0].Outputs'
```

Record: stack ID, change-set contents, `CandidateApiUrl`, `PrivateTableName`, the source commit SHA of the build, the SAM CLI version, and the `sam build` artifact digest (`find .aws-sam/build -type f -exec sha256sum {} + | sort | sha256sum`).

## Live E2E test list (staging), mapped to acceptance IDs

Every test uses synthetic data. Record request IDs, HTTP status and the DynamoDB item key, never report bodies or tokens.

| ID | Test | Expected | Acceptance |
|---|---|---|---|
| E1 | Valid report + valid Turnstile token + idempotency key | 201 with receipt. Exactly one item exists with `kind=observation` and `visibility=private`. Receipt contains no table key or token. | VIT-AC-003 |
| E2 | Same request repeated (same key, same body) | 200 `replayed`, same reference, still one item | VIT-AC-006 |
| E3 | Same key, changed body | Typed conflict and no overwrite | VIT-AC-006 |
| E4 | 20 concurrent identical submissions | Exactly one item; all responses agree on the reference | VIT-AC-006 |
| E5 | Missing, invalid, expired and reused Turnstile token | Typed 4xx and no item written | VIT-AC-005 |
| E6 | Wrong Origin, no Origin, GET, wrong path, wrong content type, body of exactly 24,576 bytes (must be accepted or validated, not 413) and of 24,577 bytes (must be 413), malformed JSON, unknown properties | 403/404/415/413/400, no item, no stack trace | VIT-AC-004 |
| E7 | Burst above stage throttle (2 rps / burst 4) | 429 from API Gateway and no unbounded writes. **Global, not per-IP.** | VIT-AC-005 |
| E8 | Revoke `secretsmanager:GetSecretValue` temporarily (in staging) | 503 `service_unavailable`, no receipt, no item | VIT-AC-007 |
| E9 | Deny `dynamodb:PutItem` temporarily (in staging) | 503 with no false receipt | VIT-AC-007 |
| E10 | Report text containing synthetic token-like canaries | Refused or redacted per domain rules. CloudWatch Logs Insights query for the canary returns 0 rows. | VIT-AC-008, VIT-AC-015 |
| E11 | Scan the Lambda log group for the canary, the Turnstile token and the report summary | 0 matches | VIT-AC-015 |
| E12 | Attempt to read or list via the API (any GET, `/api/v1/reports/<ref>`) | 404, no enumeration | VIT-AC-009 |
| E13 | Triage CLI `queue` / `show` / `advance` with an operator IAM principal, then with a principal lacking permission. Run with `VITIUM_HUMAN_OPERATOR_ROLE_ARNS` set per [OPERATOR-DECISIONS](OPERATOR-DECISIONS.md) D-25. | Authorized path works with revision guard; unauthorized gets AccessDenied | VIT-AC-011/012 |
| E14 | PITR restore drill to a new table name (see ROLLBACK-AND-DR.md) | Item count and checksum match; time measured | VIT-AC-027 (P1, informs P0 readiness) |
| E15 | Operator actor kind (VF-035, D-25): (a) a session of a role listed in `VITIUM_HUMAN_OPERATOR_ROLE_ARNS`; (b) a CI/agent role session; (c) the variable unset; (d) the variable containing a malformed entry | (a) records `authenticated-human` and may record a passing verification. (b) and (c) record `agent`, and a passing verification is refused with `human_verifier_required`. (d) the CLI exits 2 before any AWS call, with a message naming the malformed entry. | VIT-AC-011, VIT-AC-036 |

Example log check (E11):

```sh
aws logs start-query --log-group-name "/aws/lambda/<IntakeFunctionName>" \
  --start-time $(date -u -d '-1 hour' +%s) --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /VITIUM-CANARY/ | limit 5'
```

## Teardown

```sh
aws cloudformation delete-stack --stack-name vitium-intake-staging
aws cloudformation wait stack-delete-complete --stack-name vitium-intake-staging
# ReportsTable has DeletionPolicy: Retain, so it survives stack deletion by design.
aws dynamodb list-tables --query 'TableNames[?starts_with(@, `vitium-intake-staging-`)]'
aws dynamodb delete-table --table-name <retained staging table>     # staging only, after evidence export
aws secretsmanager delete-secret --secret-id vitium/staging/turnstile-secret --recovery-window-in-days 7
```

Then delete the Turnstile staging widget and confirm that the budget shows no residual spend.
