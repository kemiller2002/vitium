# SEC-002: AWS SDK supply-chain deviation and emulator-only DynamoDB evidence

- Status: **Provisional / recorded deviation**
- Date: 2026-10-08
- Requirements: VIT-NFR-008 (supply chain), VIT-API-004, VIT-AC-006
- Issue: #1

## Context

The Lambda adapter imports `@aws-sdk/client-dynamodb` and `@aws-sdk/client-secrets-manager` dynamically and relies on the copy **bundled in the AWS `nodejs22.x` runtime**. That version is chosen by AWS, changes without notice, and is not pinned or locked by this repository. Real AWS, S3, Docker Hub and Maven are unreachable from this environment, so the conditional-write behaviour cannot be exercised against real DynamoDB.

## Decision

1. **Runtime:** unchanged. Production still uses the runtime-provided SDK. This is an **unresolved supply-chain deviation**, also noted in `AGENTS.md` and `infra/aws/README.md`. It must be closed before production, either by bundling an exact SDK version into the deployment artifact (`sam build` with a `service/package.json` dependency and lockfile) or by an explicit, recorded operator exception.
2. **Tests only:** root `package.json` gains exact-pinned devDependencies, locked in `package-lock.json`:
   - `@aws-sdk/client-dynamodb@3.1139.0`: published 2026-09-23, more than two weeks before this change. It is **not** necessarily the version in the Lambda runtime.
   - `dynalite@4.0.0`: a Node DynamoDB emulator with `ConditionExpression`/`ConsistentRead` support. Published 2025.
   - `js-yaml@4.3.2`: CloudFormation-tag-aware template parsing. 4.1.0 was tried first; `npm audit` reported a high-severity advisory (merge-key prototype pollution / quadratic DoS) for `>=4.0.0 <=4.3.1`, so 4.3.2 is used. After the change, `npm audit` reports 0 vulnerabilities.
   These are not imported by any `service/` module at runtime. `npm test` passes without `node_modules` (verified by moving it aside: 65/65).
3. **Evidence labelling:** `npm run test:integration` runs the **production** `service/adapters/dynamodb-store.mjs`, `aws-handler.mjs#composeHandler` and `triage-cli.mjs#runTriage` code through the real SDK v3 wire protocol against dynalite on 127.0.0.1. This is **EMULATOR EVIDENCE, NOT AWS EVIDENCE.** Dynalite serializes requests in one process. It does not model partition-level concurrency, adaptive capacity, throttling, IAM, KMS or regional failover, and dynalite and AWS could differ in conditional-check semantics.

## Remaining blocker

A real staging DynamoDB table must run the same `tests/integration/dynamodb-store.integration.test.mjs` scenarios: 50-way same-key, mixed-body and lost-response replay. The run should use an endpoint override and real IAM credentials limited to the intake policy. The same run must also confirm that the `dynamodb:Attributes` / `dynamodb:Select` / `dynamodb:ReturnValues` IAM conditions in `infra/aws/template.yaml` allow the adapter's exact requests and deny a full-item `GetItem`. Responsible actor: the operator, with an AWS staging account. Acceptance: VIT-AC-006.
