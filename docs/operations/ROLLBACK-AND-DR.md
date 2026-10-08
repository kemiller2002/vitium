# Runbook: rollback and disaster recovery

Requirements: VIT-NFR-009 (P1), VIT-NFR-007 (P1), VIT-AC-007, VIT-AC-027 · Issue #13
RPO/RTO: **operator decisions, not set here.** No number below is a commitment.

## 1. Feature-gate rollback (private intake → legacy GitHub handoff)

This is the primary, fastest rollback. It needs no AWS action.

1. Edit `site/public-config.mjs` so that `enabled: false` (and `endpoint: ""`, `turnstileSiteKey: ""`).
2. Commit to `main` through a PR. `npm test` enforces `enabled: false` (tests/secret-scan.test.mjs, tests/p0-contract.test.mjs).
3. The `Vitium public site` workflow runs test → build → deploy → verify-canonical. Confirm all four jobs are green.
4. Verify that the served config is disabled (read-only):
   ```sh
   curl -sS https://vitium.echelonfoundry.com/public-config.mjs | grep -n 'enabled: false'
   ```
5. Browser caches may hold the old module. Pages serves with `cache-control: max-age=600`, which GitHub sets and Vitium cannot change, so allow at least that window. Separately, make the API refuse new submissions (§2) if the reason for rollback is the backend.

## 2. Backend containment

- Stop traffic: `aws lambda put-function-concurrency --function-name <IntakeFunction> --reserved-concurrent-executions 0`. This takes effect immediately, and the API returns 5xx without writing anything.
- Undo: `aws lambda delete-function-concurrency` and then redeploy the template (reserved concurrency 4).
- Code rollback: redeploy the previous built artifact with the same stack name, from the recorded commit SHA. CloudFormation rollback happens automatically on a failed update.

## 3. Pages rollback to a previous build

Re-run the `Vitium public site` workflow on the last known-good commit (`workflow_dispatch` on a branch or tag at that SHA, if environment protection allows it), or revert the offending commit on `main`. Then repeat the verification in PAGES-DNS-TLS.md.

## 4. DynamoDB point-in-time restore (PITR is enabled in the template)

PITR restores into a **new** table. It never overwrites in place.

```sh
aws dynamodb describe-continuous-backups --table-name <ReportsTable>     # confirm PITR ENABLED, note EarliestRestorableDateTime
aws dynamodb restore-table-to-point-in-time \
  --source-table-name <ReportsTable> \
  --target-table-name <ReportsTable>-restore-<UTCSTAMP> \
  --restore-date-time <ISO-8601 UTC>
aws dynamodb wait table-exists --table-name <ReportsTable>-restore-<UTCSTAMP>
```

Notes:
- The restored table does **not** carry over PITR, tags, auto-scaling or stream settings. Re-enable PITR (`update-continuous-backups`) and re-tag it.
- The GSI `ReviewQueue` is restored with the table.
- To make the restore active, either point the stack parameter or environment `REPORTS_TABLE_NAME` at the restored table, or copy items back. **No procedure has been chosen yet**: the template does not take the table name as a parameter (handoff H-07).
- Deletion requests honored after the restore point are **re-introduced** by a restore. Re-apply the deletion log after any restore (DATA-HANDLING.md §4).

## 5. What must be measured in a drill (staging only, synthetic data)

| Measurement | How |
|---|---|
| Time from incident decision to traffic stopped | Timestamp of the decision vs. the first 5xx observed |
| Time from feature-gate commit to `verify-canonical` green and the served config showing `enabled: false` | Workflow timestamps plus curl |
| PITR restore duration for N items | `restore-table-to-point-in-time` start to `ACTIVE` |
| Data delta between the restore point and the incident | Item counts and per-item `payloadHash` comparison |
| Re-application of deletion log | Count of re-deleted items |

Use these measurements to propose RPO/RTO. The **operator decides** them (OPERATOR-DECISIONS D-12).
