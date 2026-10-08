# Data handling skeleton: retention, deletion and data-subject requests

Requirements: VIT-API-006, VIT-NFR-005, VIT-NFR-011 (P1), VIT-AC-028 · Decisions: VIT-OQ-008, VIT-OQ-009 · Issue #13
Status: **SKELETON. All periods are UNDECIDED.** No real customer report may be stored until this document is completed and approved (VIT-API-006).

## 1. Data inventory (current candidate)

| Store | Content | Encryption | Current retention | Decision needed |
|---|---|---|---|---|
| DynamoDB `ReportsTable` | Private observation: normalized report, source, state, history, idempotency hash | SSE-KMS with the AWS-managed `aws/dynamodb` key (`SSEEnabled: true`) | Indefinite, with `DeletionPolicy: Retain` | Period (VIT-OQ-009); whether a customer-managed KMS key is required |
| DynamoDB PITR backups | Continuous backups covering up to 35 days | SSE | Fixed by AWS PITR window | Accept the window, or disable/shorten it to match policy |
| CloudWatch Logs `/aws/lambda/<fn>` | Lambda platform logs. App code is designed not to log report text or tokens (verify with staging E10/E11). | AWS-managed | **7 days, provisional** | Confirm |
| API Gateway access logs | **Not configured** | — | — | Decide whether to enable, and with which fields (no body, no query) |
| Cloudflare Turnstile | Challenge telemetry held by Cloudflare | Cloudflare | Cloudflare policy | Disclose in privacy notice |
| GitHub Issues (legacy path) | Public reports the reporter submits on GitHub | Public | GitHub-controlled | Public by design; deletion only by repo admin |
| Operator workstations (triage CLI output) | Report bodies shown via `show` | Local | Uncontrolled | Handling rule needed |

## 2. Retention schedule (UNDECIDED)

| Category | Retention | Basis | Approver |
|---|---|---|---|
| Unreviewed observation | UNDECIDED | UNDECIDED | UNASSIGNED |
| Rejected/spam observation | UNDECIDED | UNDECIDED | UNASSIGNED |
| Accepted observation linked to defect | UNDECIDED | UNDECIDED | UNASSIGNED |
| Application logs | 7 days (provisional) | Debugging | UNASSIGNED |

Enforcement mechanism (once periods are approved): a DynamoDB TTL attribute set at write time. This needs a template and service change; there is **no TTL today** (handoff H-06).

## 3. Data-subject / deletion request workflow (skeleton)

1. **Receive** the request through the private contact channel. **Channel UNDECIDED**; see INCIDENT-AND-ESCALATION.md.
2. **Verify** that the requester is entitled. There is no reporter identity today, and the receipt reference is *not* an auth token (VIT-OQ-005). The verification method is UNDECIDED.
3. **Locate** the record via the opaque reference using the triage CLI `show` command. Never scan the table from a public endpoint.
4. **Delete or redact** with an audited operator action. No delete command exists in the triage CLI today, and the intake role intentionally lacks `DeleteItem`. A separate operator capability is needed (handoff H-08).
5. **Propagate** the deletion (§4).
6. **Respond** within the deadline. The **deadline is UNDECIDED** and depends on jurisdiction.
7. **Record**: request time, decision, actions and operator, with no report content.

## 4. Deletion propagation

| Location | Propagation |
|---|---|
| Live table | Delete the item |
| PITR backups | Cannot selectively delete. The item ages out after the PITR window. Keep a **deletion log** of opaque keys only, and re-apply it after any restore (ROLLBACK-AND-DR.md §4). |
| CloudWatch Logs | Should contain no report content. Verify. If content is found, it is an incident (SEC/PRIV) and the log group is purged within its retention. |
| GitHub mirrors | None for private intake. Legacy public GitHub issues are deleted by a repo admin on request. |
| Operator copies | The operator attests deletion of local copies |

## 5. Breach handling

See INCIDENT-AND-ESCALATION.md. Notification obligations and the decision-maker are **UNDECIDED**.
