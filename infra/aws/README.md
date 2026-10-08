# Private intake infrastructure candidate

**No resources have been deployed.** This SAM template is a deployment candidate, not production readiness. The canonical site remains https://vitium.echelonfoundry.com/ and its proposed API is https://intake.vitium.echelonfoundry.com/api/v1/reports.

## Required approval and configuration before production intake

1. Select an AWS account/region, operator and backup, budget guardrails, data retention, deletion, breach escalation and privacy notices.
2. Provision a Cloudflare Turnstile key for vitium.echelonfoundry.com, and put the **server secret** in AWS Secrets Manager. Supply only its ARN.
3. Review the DynamoDB private table and point-in-time recovery. The candidate's **7-day application-log retention is provisional**; approve real policy before deploying.
4. Validate the actual SAM transform, pin the AWS SDK v3 dependency for immutable release packaging, and run clean builds, tests and security review. The adapter currently imports the SDK included by Lambda; that is NOT a pinned release.
5. Configure the custom API domain intake.vitium.echelonfoundry.com with an ACM TLS certificate, API mapping and DNS; the default execute-api URL is for operator testing only.
6. Verify concurrency, rate limiting, abuse/moderation, failure retries, challenge expiry, idempotency and real durable acknowledgments. Design additional protections: API Gateway throttle is global/best-effort, **not per-IP WAF**.
7. Designate the triage operator and authenticated review procedure. Public API stores a private **observation**, not a confirmed defect.
8. Only after a verified live API, configure public endpoint, Turnstile public site key and enabled=true in site/public-config.mjs.

## Proposed operator-only commands (not executed)

```bash
sam validate --lint --template-file infra/aws/template.yaml
sam build --template-file infra/aws/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

The deploy command is **not authorized** by this document; secure operational approvals are required. For staging, use the non-guided, staging-only stack procedure in [docs/operations/STAGING-READINESS.md](../../docs/operations/STAGING-READINESS.md), which reviews a change set before executing it. Operator decisions are tracked in [docs/operations/OPERATOR-DECISIONS.md](../../docs/operations/OPERATOR-DECISIONS.md).

## Transport

Browser -> API Gateway HTTP API -> Lambda (allowlisted origin and typed validation) -> Turnstile siteverify -> conditional DynamoDB PutItem -> private receipt.

- An HTTP Origin header is not authentication. Valid Turnstile proof is mandatory.
- DynamoDB's conditional write makes repeated idempotency keys converge on one record. Changed payload with same key is refused.
- The receipt acknowledges persisted data, not a verified defect or private status-access token.
- No anonymous GitHub write, public report listing, credential or private record read endpoint exists.
- No sensitive report text or Turnstile token is intentionally logged. No attachment intake.
- Backend failure MUST NOT generate a false successful receipt.

## Known gaps

Conditor and the approved F#/Limen migration have not run. No actual AWS environment, secret, DNS, certificate, CI/CD service release or verified e2e exists. Storage retention and authenticated triage policy remain open.

## Release-ops review of `template.yaml` (2026-10-08, documentation only)

This review covers the template at commit `bba1d59` and was carried out **read-only**. The template is owned by the intake/security agent, and the items below are handoffs to that agent, not changes. No `sam validate` was run locally because the SAM CLI is not installed in the review sandbox. The CI evidence is `p0-service.yml` run 37771868480 (success at `124597d`).

| ID | Area | Finding | Proposed change (intake agent) |
|---|---|---|---|
| H-01 | CORS/origin | `IntakeOrigin` `AllowedValues` and `aws-handler.mjs` both hard-require `https://vitium.echelonfoundry.com`. A staging stack therefore only accepts the production origin, so browser E2E in staging is impossible while the public gate is off. | Add an explicit staging origin and challenge hostname, selected only when `EnvironmentName=staging` (via `Conditions`/`Mappings`), and handle them in the handler's allowlist. Never use a wildcard. |
| H-02 | Abuse | `DefaultRouteSettings` throttle (2 rps, burst 4) is stage-global. One client can exhaust it for everyone (denial of service of intake). AWS WAF **cannot be attached to HTTP APIs**. | Decide between CloudFront + WAF rate-based rule in front of the API, or a REST API with WAF. Until then, document global throttling as the only control (VIT-AC-005 partially). |
| H-03 | Concurrency quota | `ReservedConcurrentExecutions: 4` fails to deploy in accounts whose concurrency quota is 10, because AWS requires at least 10 unreserved. New accounts often have a quota of 10. | Keep it, but make it a parameter, and add a pre-deploy check `aws lambda get-account-settings` to STAGING-READINESS. |
| H-04 | Package scope | `CodeUri: ../../service/` ships `triage-cli.mjs` and `triage.mjs` (operator tooling) inside the public Lambda artifact. They are unreachable but unnecessary. | Package only `aws-handler.mjs`, `http.mjs`, `intake.mjs` and `report-domain.mjs` (separate dir or esbuild bundle with a pinned SDK). |
| H-05 | Logging | No API Gateway access logs. The Lambda log group exists with 7-day retention, but it is declared as a separate resource named `/aws/lambda/${IntakeFunction}`, and SAM's managed policy still grants `logs:CreateLogGroup` on `*`. | Add `AccessLogSettings` with a JSON format limited to `requestId`, `routeKey`, `status`, `responseLength` and `integrationErrorMessage`. Do **not** add `$context.identity.sourceIp` until IP retention is decided (VIT-OQ-009). Use the function `LoggingConfig.LogGroup` so the function cannot write to an auto-created, never-expiring group. |
| H-06 | Retention | There is no DynamoDB TTL, so records live indefinitely. | Add `TimeToLiveSpecification` (attribute `expiresAt`) and set it on write once VIT-OQ-009 sets a period. Leave it unset until then. |
| H-07 | DR | The table name is not parameterizable, so a PITR restore (which creates a new table) cannot be switched in without a template edit. | Add an optional `ExistingTableName` parameter, or document copy-back. |
| H-08 | Deletion | The intake role correctly lacks `DeleteItem`, but no audited operator deletion path exists (VIT-API-006 DSR). | Add a `triage-cli delete` (or redact) with an IAM policy separate from intake. |
| H-09 | Production safety | `DeletionProtectionEnabled` is not set on the table. `EnvironmentName: production` is allowed from the same template and account. | Set `DeletionProtectionEnabled: true` when `EnvironmentName=production`. Require a separate production account (OPERATOR-DECISIONS D-07). |
| H-10 | Secrets | `GetSecretValue` is scoped to the exact ARN (good). If the secret uses a customer-managed KMS key, the role also needs `kms:Decrypt` on that key with `kms:ViaService=secretsmanager.<region>.amazonaws.com`. The secret is cached for the container lifetime, so rotation needs a cold start. | Document this, or add a short cache TTL. Confirm that the default `aws/secretsmanager` key is used in staging. |
| H-11 | Least privilege (good) | Function data access is `PutItem` and `GetItem` on the table ARN only, with no Scan/Query/Delete and no index access. Tests enforce this (`tests/p0-contract.test.mjs`). | None |
| H-12 | Supply chain | Runtime-included AWS SDK (unpinned). This is already recorded as a deviation in AGENTS.md. | Bundle a pinned SDK v3 with a lockfile before production. |
| H-13 | CORS methods | `AllowMethods` includes `OPTIONS`. HTTP API answers preflight itself, so this is harmless. `AllowCredentials` is unset (correct). | Optional cleanup |

## Proposed least-privilege deploy identities (proposal only, nothing created)

This uses two roles, so the human or CI deployer never holds broad IAM rights directly:

1. **`vitium-staging-deployer`** (assumed by the named operator via SSO/MFA). It can only drive CloudFormation for the single stack and pass the execution role.
2. **`vitium-staging-cfn-exec`** (trusted by `cloudformation.amazonaws.com` only). It holds the resource permissions the stack needs.

Placeholders: `<ACCOUNT>`, `<REGION>`, `<SAM_BUCKET>` (from `--resolve-s3` or pre-created), `<SECRET_ARN>`.

Deployer policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "StackLifecycle", "Effect": "Allow",
      "Action": ["cloudformation:CreateChangeSet","cloudformation:DescribeChangeSet","cloudformation:ExecuteChangeSet",
                 "cloudformation:DeleteChangeSet","cloudformation:DescribeStacks","cloudformation:DescribeStackEvents",
                 "cloudformation:GetTemplateSummary","cloudformation:ListStackResources","cloudformation:DeleteStack"],
      "Resource": "arn:aws:cloudformation:<REGION>:<ACCOUNT>:stack/vitium-intake-staging/*" },
    { "Sid": "SamTransform", "Effect": "Allow", "Action": "cloudformation:CreateChangeSet",
      "Resource": "arn:aws:cloudformation:<REGION>:aws:transform/Serverless-2016-10-31" },
    { "Sid": "ValidateOnly", "Effect": "Allow", "Action": ["cloudformation:ValidateTemplate"], "Resource": "*" },
    { "Sid": "PassExecRoleOnly", "Effect": "Allow", "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT>:role/vitium-staging-cfn-exec",
      "Condition": { "StringEquals": { "iam:PassedToService": "cloudformation.amazonaws.com" } } },
    { "Sid": "Artifacts", "Effect": "Allow", "Action": ["s3:PutObject","s3:GetObject"],
      "Resource": "arn:aws:s3:::<SAM_BUCKET>/vitium-intake-staging/*" }
  ]
}
```

The execution role (`vitium-staging-cfn-exec`) is scoped by action family to resources whose names begin with the stack name:

- `dynamodb:CreateTable/UpdateTable/DescribeTable/DeleteTable/UpdateContinuousBackups/DescribeContinuousBackups/TagResource/UpdateTimeToLive` on `arn:aws:dynamodb:<REGION>:<ACCOUNT>:table/vitium-intake-staging-*`
- `lambda:CreateFunction/UpdateFunctionCode/UpdateFunctionConfiguration/GetFunction/DeleteFunction/PutFunctionConcurrency/DeleteFunctionConcurrency/AddPermission/RemovePermission/TagResource` on `arn:aws:lambda:<REGION>:<ACCOUNT>:function:vitium-intake-staging-*`
- `apigateway:POST/GET/PATCH/PUT/DELETE/TagResource` on `arn:aws:apigateway:<REGION>::/apis*` (HTTP API ARNs are not name-prefixed. Accept this, or constrain it with `aws:ResourceTag/aws:cloudformation:stack-name`.)
- `logs:CreateLogGroup/DeleteLogGroup/PutRetentionPolicy/TagResource` on `arn:aws:logs:<REGION>:<ACCOUNT>:log-group:/aws/lambda/vitium-intake-staging-*`
- `iam:CreateRole/DeleteRole/GetRole/PutRolePolicy/DeleteRolePolicy/AttachRolePolicy/DetachRolePolicy/TagRole/PassRole` on `arn:aws:iam::<ACCOUNT>:role/vitium-intake-staging-*`, with a **permissions boundary** condition (`iam:PermissionsBoundary` = a boundary that allows only `dynamodb:PutItem/GetItem` on the stack table, `secretsmanager:GetSecretValue` on `<SECRET_ARN>`, and CloudWatch Logs writes). `AttachRolePolicy` is further limited to `arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`.
- `s3:GetObject` on `arn:aws:s3:::<SAM_BUCKET>/vitium-intake-staging/*`

To honor the boundary, the template would need `PermissionsBoundary` on the function role. That is handoff H-14 to the intake agent. Validate this proposal with IAM Access Analyzer `validate-policy` before use. It has **not** been tested against a real account.
