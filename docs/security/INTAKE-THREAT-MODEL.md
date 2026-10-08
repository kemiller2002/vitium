# Vitium private intake: threat model

- Status: **candidate**. Written by the P0 intake/security agent on 2026-10-08. Not independently reviewed yet; the verification agent must not treat this as self-certified.
- Scope: `POST /api/v1/reports` (`service/http.mjs`, `intake.mjs`, `redaction.mjs`, `errors.mjs`, `adapters/*`, `aws-handler.mjs`), the private DynamoDB table, and the operator CLI `service/triage-cli.mjs`, as defined in `infra/aws/template.yaml`.
- Out of scope: the static site (`site/`), the legacy GitHub issue path, F#/Limen migration, P1 status/notifications/attachments.
- Decisions: [SEC-001](../decisions/SEC-001-intake-redaction-quarantine-and-throttling.md), [SEC-002](../decisions/SEC-002-aws-sdk-supply-chain-and-emulator-evidence.md).

## 1. Assets

| ID | Asset | Why it matters |
|---|---|---|
| A1 | Report content (title, actual, expected, steps, page path) | Customer confidential; may describe vulnerabilities |
| A2 | Credentials pasted accidentally by reporters | Leakage gives attackers access to the reporter's or Echelon's systems |
| A3 | Turnstile server secret (Secrets Manager) | Lets an attacker forge challenge verification or exhaust quota |
| A4 | Challenge tokens, idempotency keys | Replay/linkability; keys are bearer handles for replay lookups |
| A5 | Receipt reference + receivedAt | Must be safe to show; must not grant access or leak existence |
| A6 | Integrity of the observation record and its triage history | Forged/duplicated reports, illegal transitions |
| A7 | Service availability / cost | Anonymous endpoint can be flooded |
| A8 | Operator terminals and agents that read reports | Injection via control characters or agent instructions |

## 2. Trust boundaries

```
 [Reporter browser] --TB1--> [Site: vitium.echelonfoundry.com (static, GitHub Pages)]
        |                           (no secrets; feature gate enabled:false)
        +----------TB2 (HTTPS, CORS, anonymous)----------> [API GW HTTP API: intake.vitium.echelonfoundry.com (pending)]
                                                                  |
                                                       TB3 (Lambda, IAM role: PutItem + projected GetItem + 1 secret)
                                                                  |----> [Cloudflare Turnstile siteverify] (TB4, third party)
                                                                  |----> [DynamoDB private table, SSE, PITR, Retain]
 [Operator workstation, IAM principal] --TB5 (AWS IAM/STS)--> Query/GetItem/UpdateItem via triage-cli.mjs
```

- **TB1 vs TB2.** The site and the intake API are different origins and different security boundaries. The site never holds secrets. The API trusts nothing from the site beyond a verified Turnstile token bound to hostname `vitium.echelonfoundry.com` and action `vitium-intake`.
- **The Origin header is not authentication.** It only stops browsers on other origins (CORS). Non-browser clients can set any Origin, so the challenge is the real gate.
- **TB5.** The operator boundary is AWS IAM only (provisional until Fides). No public route reads data.

## 3. STRIDE threats, mitigations and tests

Test IDs: `T-xx` = `tests/intake-core.test.mjs` / `intake-canary.test.mjs` / `intake-adapters.test.mjs` (in `npm test`). `D-xx` = `tests/intake-defects.test.mjs`. `I-xx` = `tests/integration/*` (dynalite emulator, `npm run test:integration`). `Y-xx` = template parse (`npm run test:integration`). The "legacy" tests are the original ones in `tests/intake.test.mjs` and `tests/p0-contract.test.mjs`.

| # | STRIDE | Threat | Mitigation | Tests |
|---|---|---|---|---|
| S1 | Spoofing | Bot submits without solving a challenge | Turnstile siteverify, hostname + action bound, checked **before** any write | T-01, T-31, legacy "challenge failure blocks storage" |
| S2 | Spoofing | Replay of a previously valid Turnstile token | Provider single-use (`timeout-or-duplicate`); verify-before-persist means a replayed token cannot write under a new key. A known key with the identical canonical body gets its original receipt without a challenge (VF-010), and that path never writes | T-02, R-01..R-03, I-05, I-09, T-31 |
| S3 | Spoofing | Cross-origin browser page submits | Exact-match Origin, no CORS grant on denial, `AllowCredentials: false` | T-10, Y-04 |
| T1 | Tampering | Same idempotency key, different body, overwrites or merges | `attribute_not_exists(pk)` conditional put; NFC canonical payload hash compared on both lookup and conditional-failure paths -> 409 | T-04, T-30, R-02, R-04, I-02, I-09, legacy conflict test |
| T2 | Tampering | Concurrent duplicate deliveries create several records | Conditional put; replay returns the original receipt | T-13, **I-01 (50-way, emulator)**, I-03 |
| T3 | Tampering | Operator transitions race or are illegal | Revision + state conditional `UpdateItem`; `triage.mjs` legal graph | I-11, I-12, T-34 |
| T4 | Tampering | Control characters/bidi spoof operator display or terminal | C0 (domain) + C1/bidi (intake) refused; CLI prints through JSON.stringify | D-04, T-12 |
| R1 | Repudiation | Operator action without attribution | STS caller ARN recorded in history per transition | I-10 |
| I1 | Info disclosure | Secrets pasted in reports are stored or logged | Redact before validate/hash/store; quarantine; allow-listed logs | D-03, T-20, T-22, I-08 |
| I2 | Info disclosure | Logs contain report text, tokens, keys, IPs, user agents, provider errors | `safe-log.mjs` allow-list: enumerated codes/flags only | T-20, T-21 |
| I3 | Info disclosure | Error responses leak infrastructure or provider detail | Catalogued messages only; effect errors become typed values | T-20, legacy "durability failure… does not leak" |
| I4 | Info disclosure | Receipt guessing/enumeration reveals existence or content | No read route; identical 404 for real and random references; 128-bit random reference | T-07, Y-04 |
| I5 | Info disclosure | Conflicting replay reveals another reporter's reference or content | 409 body is catalogue-only, with no reference/receivedAt | T-04, I-02 |
| I6 | Info disclosure | Compromised intake Lambda reads all stored reports | IAM: no Query/Scan; GetItem limited by `dynamodb:Attributes` to receipt attributes; no index access | Y-03, I-07 (adapter projects only those), T-35. **IAM conditions not verified against real IAM** (R-01) |
| I7 | Info disclosure | URL query, fragment or userinfo carries secrets | Domain strips userinfo/query/fragment; redactor screens path and text URLs | legacy pageUrl test, T-20 |
| D1 | DoS | Oversized/nested bodies consume CPU before rejection | Byte cap before base64 decode and JSON.parse | T-09 |
| D2 | DoS | Flooding exhausts capacity or cost; unbounded storage | Global stage throttle 2 rps/burst 4; reserved concurrency 4 (parameter); 24 KiB cap; challenge per write | Y-04, Y-06; **no per-IP limit** (R-03) |
| D3 | DoS | Challenge provider or storage outage | Typed 503 `temporary`, `retryable: true`; no receipt | T-05, T-06, I-04, I-06 |
| D4 | DoS | Throttled storage | `ThrottlingException` -> 429 `throttled` | I-06, T-30 |
| E1 | Elevation | Public API exposes operator operations | Only POST /api/v1/reports; everything else 404; no admin route | T-07, Y-04, legacy route test |
| E2 | Elevation | Reporter text steers agents/LLM triage ("ignore previous instructions") | Flagged `agent-instruction` -> quarantined; data is never executed | T-08 |
| E3 | Elevation | Any IAM principal with table access acts as "triager" | Documented operator policy (below); Fides deferred | **Not testable without IAM** (R-02) |
| E4 | Elevation / Spoofing | The anonymous public route is used to inject *machine* observations (forged CI/Praxis/agent findings), or to pass as an authenticated producer | Per `docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md`, `POST /api/v1/reports` is **not** a machine-to-machine route. Envelope fields (`eventId`, `eventType`, `source`, `subject`, `finding`, `evidence`, `correlation`, `observedAt`) are unknown fields, refused as `400 invalid_input` before any lookup, challenge or write. Records it stores are always `source: "public-api"` anonymous observations. The handler serves no `/api/v1/observations` path (404). The machine contract belongs to the build-system integrations owner (`service/machine/`), behind separate machine authentication, and must not reuse this route, Turnstile or the public receipt | O-05 |
| I8 | Info disclosure | Key-use oracle: an unchallenged caller probes whether an idempotency key was used | Only same-key + same-hash skips the challenge; every other case returns an identical 403 until a challenge is verified | O-01, O-02, R-02, I-09 (VF-023) |
| D5 | DoS | Unchallenged requests force storage reads | Malformed tokens are pre-filtered before I/O; the remaining read is bounded by validation, throttle and concurrency (SEC-001 "Unchallenged storage reads") | O-04 (VF-024) |

### Audit findings (failure-before / fix-after)

| ID | Defect on baseline `bba1d59` | Fix | Evidence |
|---|---|---|---|
| D-01 | Failures had no category or retry semantics (VIT-API-005) | `errors.mjs` catalogue | failed before, passes after |
| D-02 | Challenge misconfiguration (bad secret) was reported as the reporter's `challenge_failed` 403 | `misconfigured` -> 503 `unavailable` | failed before, passes after |
| D-03 | AWS keys, bearer/JWT, `github_pat_`, URL passwords, Slack tokens stored verbatim | redaction + quarantine | failed before, passes after |
| D-04 | C1 controls (8-bit CSI) accepted into stored text | refuse C1 + bidi | failed before, passes after |
| D-05 | Time-based v1 UUIDs accepted as idempotency keys (predictable, linkable) | v4 only | failed before, passes after |
| D-06 | `report-domain.mjs` regex `sk-…` lacks `\b`: "task-management-dashboard-widget" is refused as a credential | **handoff** to the typed-domain agent | `todo` test, failing |
| D-07 (minor) | Baseline `cached ??= createLiveHandler()` kept a *rejected* composition promise for the container's lifetime. This happened when configuration was incomplete or the SDK import failed. The secret itself was correctly cached only on success | the cache is reset on failure; the configuration failure is a typed value | code review only (needs a Lambda runtime to exercise) |
| D-08 (hardening) | The intake IAM policy allowed a **full-item** `GetItem`. A compromised function could therefore read any record whose key it learned. The adapter itself only projected receipt attributes | IAM `dynamodb:Attributes` condition + placeholder projection | I-07, Y-03 (static. Real IAM enforcement is R-01) |
| D-09 (hardening) | The log group was named from the function's generated name, with no `LoggingConfig`. Retention depended on CFN creating the group before the first invocation | fixed `FunctionName`, explicit `LoggingConfig.LogGroup` | Y-06 |
| D-10 | The triage CLI only listed `QUEUE#pending` and had no path for quarantined items. Its module-level code could not be tested | queue follows state, `--queue=quarantined`, pure/effect split | I-09, I-10, T-34 |

Checks that found **no defect** on baseline: challenge verified before persist (yes); durable-write failure never produced a receipt (correct, now also covered by T-05/I-04..06); no public read endpoint (correct); idempotent conflict was already a 409.

## 4. Operator (TB5) least-privilege policy (proposed, not deployed)

```json
{"Version":"2012-10-17","Statement":[
 {"Sid":"ReviewQueue","Effect":"Allow","Action":["dynamodb:Query"],"Resource":"<table-arn>/index/ReviewQueue"},
 {"Sid":"ReadAndAdvance","Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:UpdateItem"],"Resource":"<table-arn>"},
 {"Sid":"PromoteCreatesDefectOnly","Effect":"Allow","Action":["dynamodb:PutItem"],"Resource":"<table-arn>",
  "Condition":{"ForAllValues:StringLike":{"dynamodb:LeadingKeys":["DEFECT#DEF-*"]}}},
 {"Sid":"Identity","Effect":"Allow","Action":["sts:GetCallerIdentity"],"Resource":"*"}]}
```

- **Promotion (VIT-LCY-002, `triage-cli.mjs promote`)** uses one `TransactWriteItems` request. IAM has no `dynamodb:TransactWriteItems` action: every item in a transaction is authorized as its own `UpdateItem` or `PutItem`. So the only addition is `PutItem`, restricted by `dynamodb:LeadingKeys` to `DEFECT#DEF-*` partition keys. The operator role still cannot create or overwrite `REQUEST#` observations, and only the transaction's `attribute_not_exists(pk)` condition stops it from overwriting an existing defect.
- **Not granted:** Scan, DeleteItem, BatchWriteItem or table admin. Require MFA in the role trust policy. CLI output must never go to public CI logs.
- **Separation:** the public intake function role is unchanged: conditional `PutItem` plus projected `GetItem`, no `UpdateItem`, nothing on `DEFECT#`. Promotion permissions live only on the operator side.
- **Where it lives:** the operator role is **not** modelled in `infra/aws/template.yaml`. That is deliberate, because operator principals are account- and SSO-specific and undecided (R-02). This policy is a proposal for the operator to create. It has **not** been checked by IAM Access Analyzer or exercised against real IAM.
- **Evidence:** the emulator cannot prove transaction atomicity. dynalite 4.0.0 returns `UnknownOperationException` for `TransactWriteItems`. Tests I-30..I-35 run the CLI's transaction plan through a test-only shim that evaluates each item's condition in dynalite. Real transaction behaviour stays under blocker R-01.

## 5. Residual risks requiring operator decisions

| ID | Risk | Needed decision/action | Acceptance |
|---|---|---|---|
| R-01 | IAM condition keys (`dynamodb:Attributes`, `Select`, `ReturnValues`) and DynamoDB conditional semantics are proven only by static review and the dynalite emulator, not by AWS | Run `tests/integration` against a staging table with the real intake role; also confirm that a full-item GetItem is denied | VIT-AC-006/009 |
| R-02 | Operator authorization is plain IAM, with no role separation (triager vs verifier) | Approve the operator principal(s) and the policy above; Fides later | VIT-OQ-008, VIT-AC-011 |
| R-03 | No per-source rate limit; a global throttle lets one actor deny service to all | Accept, or fund WAF (REST API/CloudFront topology change) | VIT-AC-005 |
| R-04 | Storage growth is unbounded over time (no TTL) | Retention period and deletion workflow | VIT-OQ-009, VIT-API-006 |
| R-05 | Pattern redaction misses novel secret formats and PII (names, emails, phone numbers are **not** redacted) | Accept guardrail scope or approve a DLP service; privacy notice wording | VIT-AC-008, VIT-OQ-009 |
| R-06 | Turnstile single-use and hostname binding are provider-documented, not live-verified | Provision a staging site key/secret; run replay and wrong-hostname checks live | VIT-AC-003/005 |
| R-07 | Runtime AWS SDK is unpinned (SEC-002) | Bundle a pinned SDK, or record an exception | VIT-NFR-008 |
| R-08 | Security-escalation flag has no recipient; quarantined items are seen only when an operator runs the CLI | Name the security contact and review interval; alerting is P1 (VIT-NFR-006) | VIT-API-007, VIT-OQ-008 |
| R-09 | Log retention of 7 days is provisional | Approve the retention value | VIT-OQ-009 |
| R-10 | No custom domain/TLS for `intake.vitium.echelonfoundry.com` | DNS + ACM + API mapping | VIT-AC-003 |
| R-11 | Idempotency key is a bearer handle for its receipt: anyone who knows key and body gets the same reference back | Acceptable: only the reporter holds both. A status capability must stay separate (#12) | VIT-AC-009 |

## 6. Status capability (VIT-API-010, P1, deferred to #12): design constraints

- The receipt reference stays non-secret and **never** authorizes reads.
- A status capability must be a separate random value of at least 128 bits, returned once, and stored only as `sha256(capability)`. It must be revocable and expiring. A lookup answers identically for unknown and revoked capabilities, and answers only coarse states (received / under review / closed). The product must not be revealed across tenants.
- It needs its own route, its own IAM statement (GetItem on a separate capability-hash key, never on `REQUEST#…`), and its own throttle.
