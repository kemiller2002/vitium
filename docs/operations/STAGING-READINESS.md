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
| S6 | Staging origin decision (**blocking**, see below) | Template/handler accept a staging origin, or staging E2E is limited to non-browser API tests | handoff H-01 |
| S7 | Log retention for staging | Provisional 7 days is in the template; approver confirms for staging | VIT-OQ-009 |
| S8 | Synthetic-data-only rule | Staging receives synthetic reports only and no real customer data until VIT-API-006 is approved | VIT-API-006 |
| S9 | Deploy identity | Least-privilege deployer and CloudFormation execution roles per `infra/aws/README.md` | VIT-NFR-004 |
| S10 | Teardown owner | Named person who deletes the stack **and** the retained table after testing | — |

### S6: staging origin is currently impossible to test in a browser

`infra/aws/template.yaml` restricts `IntakeOrigin` to `AllowedValues: [https://vitium.echelonfoundry.com]`. `service/aws-handler.mjs` refuses to start unless `ALLOWED_ORIGIN === "https://vitium.echelonfoundry.com"` and `CHALLENGE_HOSTNAME === "vitium.echelonfoundry.com"`. As a result, a staging stack only accepts browser traffic from the production site, whose public config must stay `enabled: false`. There are two options:

- **(a) Lowest risk, provisional:** run staging E2E as **non-browser HTTP tests** that send `Origin: https://vitium.echelonfoundry.com` against the execute-api URL. Turnstile must still pass, which needs a real token for the canonical hostname, so a browser is still required to obtain tokens. Without one, only the negative tests below can run.
- **(b)** The intake agent adds a staging origin and hostname, for example a separate Pages project or `staging.vitium.echelonfoundry.com`, as an explicit `AllowedValues` entry selected only when `EnvironmentName=staging`. A matching Turnstile widget hostname is also needed. This is handoff H-01.

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
| E6 | Wrong Origin, no Origin, GET, wrong path, wrong content type, body larger than 16 KiB, malformed JSON, unknown properties | 403/404/415/413/400, no item, no stack trace | VIT-AC-004 |
| E7 | Burst above stage throttle (2 rps / burst 4) | 429 from API Gateway and no unbounded writes. **Global, not per-IP.** | VIT-AC-005 |
| E8 | Revoke `secretsmanager:GetSecretValue` temporarily (in staging) | 503 `service_unavailable`, no receipt, no item | VIT-AC-007 |
| E9 | Deny `dynamodb:PutItem` temporarily (in staging) | 503 with no false receipt | VIT-AC-007 |
| E10 | Report text containing synthetic token-like canaries | Refused or redacted per domain rules. CloudWatch Logs Insights query for the canary returns 0 rows. | VIT-AC-008, VIT-AC-015 |
| E11 | Scan the Lambda log group for the canary, the Turnstile token and the report summary | 0 matches | VIT-AC-015 |
| E12 | Attempt to read or list via the API (any GET, `/api/v1/reports/<ref>`) | 404, no enumeration | VIT-AC-009 |
| E13 | Triage CLI `queue` / `show` / `advance` with an operator IAM principal, then with a principal lacking permission | Authorized path works with revision guard; unauthorized gets AccessDenied | VIT-AC-011/012 |
| E14 | PITR restore drill to a new table name (see ROLLBACK-AND-DR.md) | Item count and checksum match; time measured | VIT-AC-027 (P1, informs P0 readiness) |

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
