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

\`\`\`bash
sam validate --lint --template-file infra/aws/template.yaml
sam build --template-file infra/aws/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
\`\`\`

The deploy command is **not authorized** by this document; secure operational approvals are required.

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
