#!/usr/bin/env node
// Mutation-sensitivity appraisal (VIT-VER-003, VIT-AC-023 precursor).
// Each mutant is applied to a throw-away COPY of the repository under a scratch
// directory; the working tree is never modified. For every mutant we run the
// selected suites in the copy and record whether any test failed ("killed").
//
// Usage: node tests/verification/mutation-appraisal.mjs --scratch=<dir> [--suites=unit,adversarial,browser] [--only=M1,M2]
// Output: JSON lines on stdout plus <scratch>/mutation-results.json
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Each mutant: a plausible wrong implementation of an important guard.
 * Fix round 1: anchors retargeted to the integrated tree (p0/integration @ 2b9de54):
 * service/lifecycle.mjs, service/redaction.mjs, site/state.mjs, site/private-intake.mjs,
 * site/view.mjs. M21+ are new targets for code paths added during integration. */
export const MUTANTS = Object.freeze([
  // ---- legacy GitHub handoff (site/submission.mjs) ----
  { id: "M01", guard: "Legacy URL sanitisation keeps query/fragment", req: "VIT-REP-007 / VIT-AC-008", file: "site/submission.mjs",
    from: "  const sanitized = parsed.origin + parsed.pathname;", to: "  const sanitized = parsed.href;" },
  { id: "M02", guard: "Legacy URL scheme allowlist removed", req: "VIT-API-002 / VIT-AC-004", file: "site/submission.mjs",
    from: 'if (!["http:", "https:"].includes(parsed.protocol)) {', to: "if (false) {" },
  // ---- service validation / transport ----
  { id: "M03", guard: "Service URL sanitisation keeps query/fragment", req: "VIT-API-002 / VIT-AC-008", file: "service/report-domain.mjs",
    from: "pageUrl = url.origin + url.pathname;", to: "pageUrl = url.href;" },
  { id: "M11", guard: "Product list mismatch (service gains an unknown product)", req: "VIT-DOM-004 / VIT-AC-010", file: "service/report-domain.mjs",
    from: '"Forma Studio", "HelixNote", "Ordo", "Praxis", "Signal", "Summa", "Other / not sure"',
    to: '"Forma Studio", "HelixNote", "Ordo", "Praxis", "Signal", "Summa", "Vitium", "Other / not sure"' },
  { id: "M12", guard: "Product mismatch only in site HTML <select>", req: "VIT-DOM-004 / VIT-AC-010", file: "site/index.html",
    from: "<option>Summa</option>", to: "<option>Summa</option><option>Vitium</option>" },
  { id: "M14", guard: "Unexpected-property refusal removed", req: "VIT-API-002 / VIT-AC-004", file: "service/report-domain.mjs",
    from: 'if (!allowed.has(key)) refuse("Unexpected report field.");', to: "" },
  { id: "M13", guard: "Origin check uses suffix match", req: "VIT-API-001", file: "service/http.mjs",
    from: "if (origin !== allowedOrigin) return", to: "if (!String(origin).endsWith(\"vitium.echelonfoundry.com\")) return" },
  { id: "M15", guard: "Decoded body limit counts characters not bytes", req: "VIT-API-002 / VIT-AC-005", file: "service/http.mjs",
    from: 'if (Buffer.byteLength(input, "utf8") > MAX_BODY_BYTES)', to: "if (input.length > MAX_BODY_BYTES)" },
  // ---- intake core (service/intake.mjs) ----
  { id: "M04", guard: "Idempotency conflict check removed (altered body replays old receipt)", req: "VIT-API-004 / VIT-AC-006", file: "service/intake.mjs",
    from: 'if (existing.payloadHash !== item.payloadHash) return fail(intakeFailure("request_conflict"));', to: "" },
  { id: "M05", guard: "Store before challenge", req: "VIT-API-003 / VIT-AC-005", file: "service/intake.mjs",
    from: "      const challenge = await settleChallenge(verifyChallenge, token.value);",
    to: "      await settleStore(store, buildObservation({storageKey: storageKey.value, ...prepared.value, reference: reference(), receivedAt: now()}));\n      const challenge = await settleChallenge(verifyChallenge, token.value);" },
  { id: "M06", guard: "Truthy (non-boolean) challenge result accepted", req: "VIT-API-003", file: "service/intake.mjs",
    from: "  if (result) return result.ok ? ok(result.value === true) : fail(result.error === \"misconfigured\" ? \"misconfigured\" : \"unavailable\");\n  return ok(value === true);",
    to: "  if (result) return result.ok ? ok(Boolean(result.value)) : fail(result.error === \"misconfigured\" ? \"misconfigured\" : \"unavailable\");\n  return ok(Boolean(value));" },
  { id: "M07", guard: "Receipt despite malformed store reply", req: "VIT-API-005 / VIT-AC-007", file: "service/intake.mjs",
    from: "  return value && typeof value.created === \"boolean\" ? ok(value) : fail(\"unavailable\");", to: "  return ok({created: true});" },
  { id: "M08", guard: "Store failure swallowed and treated as created", req: "VIT-API-005 / VIT-AC-007", file: "service/intake.mjs",
    from: "  try { value = await store.putOnce(item); } catch { return fail(\"unavailable\"); }", to: "  try { value = await store.putOnce(item); } catch { return ok({created: true}); }" },
  { id: "M21", guard: "Inconsistent store reply (no existing) treated as conflict", req: "VIT-API-005 / VIT-AC-007 (VF-013)", file: "service/intake.mjs",
    from: '  if (value.created !== false || !existing || typeof existing.payloadHash !== "string") {\n    return fail(intakeFailure("storage_unavailable"));',
    to: '  if (value.created !== false || !existing || typeof existing.payloadHash !== "string") {\n    return fail(intakeFailure("request_conflict"));' },
  { id: "M22", guard: "Quarantine disposition dropped (credential-bearing report stored as received)", req: "VIT-AC-008 / SEC-001", file: "service/intake.mjs",
    from: 'disposition: flags.length ? "quarantined" : "received"', to: 'disposition: "received"' },
  { id: "M23", guard: "Unsafe display characters (C1/bidi) no longer refused at intake", req: "VIT-API-002 / SEC-001 (VF-008)", file: "service/intake.mjs",
    from: '    if (hasUnsafeDisplayCharacters(value)) return fail(intakeFailure("invalid_input","The report contains invalid characters."));', to: "" },
  { id: "M24", guard: "Page URL path no longer screened for credentials", req: "VIT-AC-008 / SEC-001 (VF-009)", file: "service/intake.mjs",
    from: "  const path = redactText(normalized.pageUrl);", to: "  const path = {text: normalized.pageUrl, findings: []};" },
  // ---- redaction (service/redaction.mjs) ----
  { id: "M25", guard: "Redaction keeps the secret (placeholder appended, value retained)", req: "VIT-AC-008 / VIT-NFR-004", file: "service/redaction.mjs",
    from: "      return raw ? expanded : expanded + PLACEHOLDER;", to: "      return match[0] + PLACEHOLDER;" },
  { id: "M26", guard: "GitHub token rule removed", req: "VIT-AC-008", file: "service/redaction.mjs",
    from: '  {kind:"github-token", pattern:/\\b(?:gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{20,})/g},', to: "" },
  { id: "M27", guard: "AWS key id rule removed", req: "VIT-AC-008", file: "service/redaction.mjs",
    from: '  {kind:"aws-access-key-id", pattern:/\\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\\b/g},', to: "" },
  { id: "M28", guard: "Vulnerability language no longer flagged (no private escalation)", req: "VIT-API-007 / SEC-001", file: "service/redaction.mjs",
    from: '  if (vulnerabilityLanguage.test(corpus)) flags.push("possible-vulnerability");', to: "" },
  { id: "M29", guard: "Agent-instruction text no longer quarantined", req: "VIT-AC-008 / SEC-001", file: "service/redaction.mjs",
    from: '  if (agentInstruction.test(corpus)) flags.push("agent-instruction");', to: "" },
  { id: "M30", guard: "Payment-card Luhn check removed (any 13-19 digit run redacted or none)", req: "VIT-AC-008", file: "service/redaction.mjs",
    from: "    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return candidate;", to: "    return candidate;" },
  // ---- lifecycle engine (service/lifecycle.mjs) ----
  { id: "M09", guard: "Table edge lookup removed (any transition allowed)", req: "VIT-LCY-001 / VIT-AC-012", file: "service/lifecycle.mjs",
    from: '  if (!rule) return fail("forbidden_transition", "Transition not permitted.", { from: record.state, to: command.to ?? null });',
    to: '  if (!rule) return evaluateTransition({ ...table, machines: { ...table.machines, [record.kind]: { ...machine, transitions: [...machine.transitions, { from: record.state, to: command.to, roles: table.roles, reasonRequired: true, requiredFields: [], optionalFields: Object.keys(table.fields), evidenceAnyOf: [] }] } } }, record, command, options);' },
  { id: "M10", guard: "Table role guard removed", req: "VIT-LCY-004 / VIT-VER-006", file: "service/lifecycle.mjs",
    from: '  if (!rule.roles.includes(command.role)) return fail("unauthorized_role", rule.roleRationale || "The actor is not authorized.");\n  if (!isText(command.reason))',
    to: '  if (!isText(command.reason))' },
  { id: "M16", guard: "Transition reason requirement removed", req: "VIT-LCY-004 / VIT-AC-012", file: "service/lifecycle.mjs",
    from: '  if (!rule.roles.includes(command.role)) return fail("unauthorized_role", rule.roleRationale || "The actor is not authorized.");\n  if (!isText(command.reason)) return fail("missing_reason", "A bounded reason is required.");\n  if (command.reason.length > table.reasonMaxLength) return fail("reason_too_long", "A bounded reason is required.");',
    to: '  if (!rule.roles.includes(command.role)) return fail("unauthorized_role", rule.roleRationale || "The actor is not authorized.");' },
  { id: "M31", guard: "Table evidence obligation removed", req: "VIT-LCY-004 / DOM-001", file: "service/lifecycle.mjs",
    from: "  if (rule.evidenceAnyOf.length && !evidence.value.some(e => rule.evidenceAnyOf.includes(e.kind))) {\n    const label",
    to: "  if (false) {\n    const label" },
  { id: "M32", guard: "Required fields (duplicateOf/supersededBy/classification) not enforced", req: "VIT-LCY-004 (VF-015)", file: "service/lifecycle.mjs",
    from: '  if (missing) return fail("missing_field", missingFieldMessage(missing));', to: "" },
  { id: "M33", guard: "Field pattern validation removed (any duplicateOf accepted)", req: "VIT-LCY-004 / VIT-DOM-001", file: "service/lifecycle.mjs",
    from: '  if (invalid) return fail("invalid_field", "Field " + invalid[0] + " is invalid.");', to: "" },
  { id: "M34", guard: "Stale revision guard removed", req: "VIT-LCY-005 precursor", file: "service/lifecycle.mjs",
    from: '  if (!Number.isSafeInteger(record.revision) || record.revision < 0 || record.revision !== command.expectedRevision) {\n    return fail("stale_revision", "Stale or invalid revision.");\n  }\n  const owned',
    to: "  const owned" },
  { id: "M35", guard: "Reopen no longer points at the prior closure", req: "VIT-AC-012 / DOM-001", file: "service/lifecycle.mjs",
    from: "    ...(priorClosure ? { reopens: priorClosure } : {}),", to: "" },
  { id: "M36", guard: "Promotion allowed from any observation state", req: "VIT-LCY-002 / VIT-AC-011", file: "service/lifecycle.mjs",
    from: '  if (observation.state !== p.fromState) return fail("forbidden_transition", "Only a classified observation can be promoted.");', to: "" },
  { id: "M37", guard: "Table loader accepts a table claiming Ordo authority", req: "VIT-NFR-002 / DOM-001", file: "service/lifecycle.mjs",
    from: '  if (raw.ordoAuthorized !== false || raw.authority !== "vitium-domain-candidate") {', to: "  if (false) {" },
  // ---- site state machine, intake client, view, app ----
  { id: "M17", guard: "View renders report text as HTML", req: "VIT-AC-004 / threat model", file: "site/view.mjs",
    from: "const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };",
    to: "const setText = (el, value) => { if (el && el.innerHTML !== value) el.innerHTML = value; };" },
  { id: "M18", guard: "Private intake gate fails open", req: "VIT-AC-003 gate / VIT-AC-015", file: "site/private-intake.mjs",
    from: "  return c.enabled === true &&", to: "  return true || c.enabled === true &&" },
  { id: "M20", guard: "Edit clears typed content", req: "VIT-AC-002 / VIT-UX-003", file: "site/state.mjs",
    from: '    phase: "draft", report: null, handoffUrl: null, error: null, fieldErrors: freeze([]),\n    challenge: freeze({ status: "idle", token: "" }),',
    to: '    phase: "draft", values: EMPTY_VALUES, report: null, handoffUrl: null, error: null, fieldErrors: freeze([]),\n    challenge: freeze({ status: "idle", token: "" }),' },
  { id: "M38", guard: "Reducer skips receipt re-validation (defence in depth)", req: "VIT-UX-004 / VIT-AC-003", file: "site/state.mjs",
    from: "    if (!receipt || receipt.reference !== outcome.receipt.reference) return unchanged(state);", to: "" },
  { id: "M39", guard: "Receipt parser accepts any status string as accepted", req: "VIT-UX-004 / VIT-AC-003", file: "site/private-intake.mjs",
    from: '  if (body.status !== "received") return null;', to: "" },
  { id: "M40", guard: "Receipt parser accepts any reference format", req: "VIT-UX-004 / VIT-DOM-002", file: "site/private-intake.mjs",
    from: '  if (typeof body.reference !== "string" || !REFERENCE_PATTERN.test(body.reference)) return null;', to: "" },
  { id: "M41", guard: "Receipt parser accepts non-2xx statuses", req: "VIT-API-005 / VIT-AC-007", file: "site/private-intake.mjs",
    from: "  if (!(status === 200 || status === 201)) return null;", to: "" },
  { id: "M42", guard: "Site no longer blocks credential-looking text (both channels)", req: "VIT-AC-008 / VF-004", file: "site/submission.mjs",
    from: '  if (credentialKinds(value).length) return fieldError(field, "credential", CREDENTIAL_MESSAGE);', to: "" },
  { id: "M43", guard: "Challenge token not required before send", req: "VIT-API-003 / VIT-UX-004", file: "site/state.mjs",
    from: '  if (state.challenge.status !== "ready" || !state.challenge.token) {\n    return notice(', to: '  if (false) {\n    return notice(' },
  { id: "M44", guard: "Accepted state keeps the draft (draft persists after acceptance)", req: "VIT-UX-004 / privacy", file: "site/state.mjs",
    from: "      values: EMPTY_VALUES, report: null, attempt: null,", to: "      report: null, attempt: null," },
  { id: "M45", guard: "Stale/foreign submit result accepted (no correlation check)", req: "VIT-API-004 / VIT-UX-004", file: "site/state.mjs",
    from: "  if (event.correlationId !== state.attempt.idempotencyKey) return unchanged(state);", to: "" },
  { id: "M46", guard: "Replay lookup skipped (lost-response retry needs a fresh challenge again)", req: "VIT-API-004 / VF-010", file: "service/intake.mjs",
    from: "      if (sameReport) return decideReceipt(", to: "      if (false) return decideReceipt(" },
  { id: "M57", guard: "Verified conflict falls through to a new write under a used key", req: "VIT-API-004 / VF-023", file: "service/intake.mjs",
    from: "      if (known.value.found) return decideReceipt(", to: "      if (false) return decideReceipt(" },
  { id: "M47", guard: "Replay path ignores payload hash (any body under a known key gets the receipt)", req: "VIT-API-004 / VIT-AC-009", file: "service/intake.mjs",
    from: "      if (known.value.found) return decideReceipt({payloadHash: hash},", to: "      if (known.value.found) return decideReceipt({payloadHash: known.value.existing.payloadHash}," },
  { id: "M48", guard: "Report text not NFC-normalised before hashing", req: "VIT-AC-006 / VF-008", file: "service/intake.mjs",
    from: 'typeof v === "string" ? v.normalize("NFC") : v', to: "v" },
  { id: "M49", guard: "Owned-history check removed (truncated history accepted)", req: "VIT-DOM-007 / VF-016", file: "service/lifecycle.mjs",
    from: '  if (history.filter(e => e.sequence !== 0).length !== record.revision) return fail("inconsistent_history", "Record history does not match its revision.");', to: "" },
  { id: "M50", guard: "History aliased, not deep-copied", req: "VIT-LCY-004 / VF-016", file: "service/lifecycle.mjs",
    from: "  return ok(Object.freeze(history.map(e => deepFreeze(structuredClone(e)))));", to: "  return ok(history);" },
  { id: "M51", guard: "Instant range check removed (prefix-only timestamp)", req: "VIT-DOM-007 / VF-017", file: "service/lifecycle.mjs",
    from: "  return month >= 1 && month <= 12 && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59 && offH <= 23 && offM <= 59;", to: "  return true;" },
  { id: "M52", guard: "Site page-URL length measured before sanitising", req: "VIT-UX-007 / VF-011", file: "site/submission.mjs",
    from: "  if (lengthOf(sanitized) > LEGACY_LIMITS.pageUrl) {", to: "  if (lengthOf(value) > LEGACY_LIMITS.pageUrl) {" },
  { id: "M53", guard: "Site URL credential check removed", req: "VIT-AC-008 / VF-009", file: "site/submission.mjs",
    from: "  if (credentialKinds(sanitized).length) {", to: "  if (false) {" },
  { id: "M54", guard: "Session-id URL rule removed from site guard", req: "VIT-AC-008 / VF-009", file: "site/credential-guard.mjs",
    from: '  { kind: "url-session-parameter", pattern: /;(?:jsessionid|phpsessid|sessionid|sid)=[^\\s;\\/?#]+/i },', to: "" },
  { id: "M55", guard: "Replay lookup projects the report body", req: "VIT-AC-009 / SEC-001", file: "service/adapters/dynamodb-store.mjs",
    from: 'export const REPLAY_ATTRIBUTES = Object.freeze(["reference","payloadHash","receivedAt","disposition"]);', to: 'export const REPLAY_ATTRIBUTES = Object.freeze(["reference","payloadHash","receivedAt","disposition","report"]);' },
  { id: "M56", guard: "Receipt exposes disposition (detector oracle)", req: "VIT-AC-009 / VF-020", file: "service/intake.mjs",
    from: "  status: \"received\",\n  replayed\n});", to: "  status: \"received\",\n  disposition: \"received\",\n  replayed\n});" },
  // ---- round 3: domain verification cycle (V-series, independent of the owner's list) ----
  { id: "V01", guard: "duplicate attemptId accepted", req: "VIT-LCY-010 / DOM-001 §18", file: "service/lifecycle.mjs",
    from: "    if (cycle.submittedAttempts.includes(fields.attemptId)) {", to: "    if (false) {" },
  { id: "V02", guard: "agent repair budget not enforced", req: "VIT-VER-011 / mission §7", file: "service/lifecycle.mjs",
    from: '    if (provenance === "agent" && agentRepairBudget(table, history, options.maxFailedAttempts).exhausted) {', to: "    if (false) {" },
  { id: "V03", guard: "outcome mismatch ignored (inconclusive can resolve)", req: "VIT-VER-010 / VIT-AC-036", file: "service/lifecycle.mjs",
    from: "  if (outcome !== undefined && outcome !== a.outcome) {", to: "  if (false) {" },
  { id: "V04", guard: "result need not name the latest submission", req: "VIT-VER-009 / VIT-LCY-010", file: "service/lifecycle.mjs",
    from: "  if (latest && (latest.attemptId !== fields.attemptId || latest.candidateRevision !== fields.candidateRevision)) {\n    return fail(\"attempt_mismatch\", \"Verification results must name the submitted candidate (latest attemptId and candidateRevision).\");\n  }\n  const independence",
    to: "  const independence" },
  { id: "V05", guard: "independence check removed (author passes own attempt)", req: "VIT-VER-006 / VIT-AC-036", file: "service/lifecycle.mjs",
    from: "&& latest?.author && latest.author === command.actor) {", to: "&& false) {" },
  { id: "V06", guard: "inconclusive counted as failure", req: "VIT-VER-010", file: "service/lifecycle.mjs",
    from: '    if (valueOf(list[i], "verificationOutcome") === "failed") failedInOpenCycle++;', to: '    if (["failed", "inconclusive"].includes(valueOf(list[i], "verificationOutcome"))) failedInOpenCycle++;' },
  { id: "V07", guard: "escalation event does not reset the cycle", req: "VIT-VER-011", file: "service/lifecycle.mjs",
    from: 'const isCycleBoundary = e => e?.to === "reopened" || e?.type === "escalation";', to: 'const isCycleBoundary = e => e?.to === "reopened";' },
  { id: "V08", guard: "event provenance restriction removed (agent may escalate)", req: "VIT-VER-011 / mission §7", file: "service/lifecycle.mjs",
    from: "  if (def.provenances && !def.provenances.includes(actor.value)) return fail(", to: "  if (false) return fail(" },
  { id: "V09", guard: "reopen-and-resume returns partial application on step-2 failure", req: "VIT-LCY-011", file: "service/lifecycle.mjs",
    from: '  if (!second.ok) return fail(second.error.code, second.error.message, { step: "resume" });', to: '  if (!second.ok) return ok(Object.freeze({ record: first.value.record, events: Object.freeze([first.value.event]) }));' },
  { id: "V10", guard: "inconclusive recorded against a stale attempt", req: "VIT-VER-010 / VIT-VER-009", file: "service/lifecycle.mjs",
    from: "  if (latest && (latest.attemptId !== fields.attemptId || latest.candidateRevision !== fields.candidateRevision)) {\n    return fail(\"attempt_mismatch\", \"Verification results must name the submitted candidate (latest attemptId and candidateRevision).\");\n  }\n  const event",
    to: "  const event" },
  { id: "V11", guard: "attempt guards skipped entirely", req: "VIT-LCY-010 / VIT-VER-009", file: "service/lifecycle.mjs",
    from: "  const attempt = rule.attempt ? checkAttempt(table, rule, record, history, fields, command, actor.value, options) : ok({});", to: "  const attempt = ok({});" },
  // ---- round 3: machine boundary (17) ----
  { id: "MC01", guard: "principal brand not recorded (no principal ever verifies)", req: "VIT-INT-016", file: "service/machine/principal.mjs",
    from: "    minted.add(principal);", to: "" },
  { id: "MC02", guard: "any object accepted as principal", req: "VIT-INT-016", file: "service/machine/principal.mjs",
    from: "export const isVerifiedPrincipal = value => isObject(value) && minted.has(value);", to: "export const isVerifiedPrincipal = value => isObject(value);" },
  { id: "MC03", guard: "principal expiry ignored", req: "VIT-INT-016", file: "service/machine/principal.mjs",
    from: "  if (!Number.isFinite(nowMs) || Date.parse(principal.expiresAt) <= nowMs) return fail(", to: "  if (false) return fail(" },
  { id: "MC04", guard: "source.system not bound to principal (forged identity)", req: "VIT-INT-016 / VIT-AC-035", file: "service/machine/principal.mjs",
    from: "  if (envelope.source.system !== principal.system) return fail(", to: "  if (false) return fail(" },
  { id: "MC05", guard: "repository scope not enforced", req: "VIT-INT-016", file: "service/machine/principal.mjs",
    from: "  if (!principal.repositories.includes(envelope.source.repository)) return fail(", to: "  if (false) return fail(" },
  { id: "MC06", guard: "environment scope not enforced", req: "VIT-INT-016", file: "service/machine/principal.mjs",
    from: "  if (!principal.environments.includes(envelope.subject.environment)) return fail(", to: "  if (false) return fail(" },
  { id: "MC07", guard: "event-type scope not enforced", req: "VIT-INT-016", file: "service/machine/principal.mjs",
    from: "  if (!principal.eventTypes.includes(envelope.eventType)) return fail(", to: "  if (false) return fail(" },
  { id: "MC08", guard: "eventId conflict ignored (different content replays)", req: "VIT-AC-035", file: "service/machine/observation-core.mjs",
    from: '    if (v.existing.canonicalHash !== record.canonicalHash) return fail(machineFailure("event_conflict"));', to: "" },
  { id: "MC09", guard: "echo suppression removed (recursive Vitium feedback)", req: "VIT-INT-015 / BSR test 8", file: "service/machine/observation-core.mjs",
    from: '      if (isEcho(envelope, principal)) return ok(', to: '      if (false) return ok(' },
  { id: "MC10", guard: "security routing removed (Tutela finding publicly projectable)", req: "VIT-API-007 / BSR", file: "service/machine/observation-core.mjs",
    from: "  const security = SECURITY_CATEGORIES.includes(envelope.finding.category)", to: "  const security = false && SECURITY_CATEGORIES.includes(envelope.finding.category)" },
  { id: "MC11", guard: "stale vs conflict ordering inverted", req: "VIT-AC-035", file: "service/machine/observation-core.mjs",
    from: 'Date.parse(record.observedAt) < Date.parse(v.attemptTaken.observedAt) ? "stale_event" : "attempt_conflict"', to: '"attempt_conflict"' },
  { id: "MC12", guard: "self-certification check removed", req: "VIT-AC-036", file: "service/machine/observation-core.mjs",
    from: '  if (attempt.author?.principalId === principal.principalId) { flags.push("self-certification"); return withhold("self-certification"); }', to: "" },
  { id: "MC13", guard: "flaky/infrastructure category not withheld", req: "VIT-VER-010", file: "service/machine/observation-core.mjs",
    from: '  if (INCONCLUSIVE_CATEGORIES.includes(envelope.finding.category)) { flags.push("possibly-inconclusive"); return withhold("infrastructure-or-flaky-category"); }', to: "" },
  { id: "MC14", guard: "producer classification trusted (not forced untriaged)", req: "VIT-AC-032", file: "service/machine/observation-core.mjs",
    from: '    classification: "untriaged",', to: "    classification: envelope.finding.classification === \"untriaged\" ? \"confirmed\" : \"untriaged\"," },
  { id: "MC15", guard: "credential-named fields not refused first", req: "VIT-INT-016", file: "service/machine/observation-core.mjs",
    from: "  const credentialPath = findCredentialField(raw);", to: "  const credentialPath = null;" },
  { id: "MC16", guard: "causation ordering not enforced", req: "VIT-AC-035", file: "service/machine/observation-core.mjs",
    from: '        if (found.value?.found !== true) return fail(machineFailure("causation_unknown"));', to: "" },
  { id: "MC17", guard: "outbox retries forever (no exhaustion)", req: "VIT-AC-035 / BSR", file: "service/machine/outbox.mjs",
    from: '  if (attempts >= p.value.maxAttempts) return dead("retry-exhausted", lastError, attempts);\n  if (expired)', to: "  if (expired)" },
  // ---- round 3: triage CLI composite / transaction conditions ----
  { id: "CL01", guard: "defect update without revision condition", req: "VIT-LCY-005 precursor / LCY-011", file: "service/triage-cli.mjs",
    from: 'ConditionExpression:"attribute_exists(pk) AND #kind = :kind AND revision = :expected AND #state = :before",', to: 'ConditionExpression:"attribute_exists(pk) AND #kind = :kind",' },
  { id: "CL02", guard: "promotion allows double promotion", req: "VIT-LCY-002 / VIT-AC-011", file: "service/triage-cli.mjs",
    from: " AND attribute_not_exists(promotedTo)\",", to: "\"," },
  { id: "CL03", guard: "promotion does not require classified state", req: "VIT-LCY-002", file: "service/triage-cli.mjs",
    from: "AND #state = :classified AND revision = :expected", to: "AND revision = :expected" },
  { id: "CL04", guard: "observation update without state condition", req: "VIT-LCY-005 precursor", file: "service/triage-cli.mjs",
    from: '    ConditionExpression:"attribute_exists(pk) AND revision = :expected AND #state = :before",', to: '    ConditionExpression:"attribute_exists(pk) AND revision = :expected",' }
]);

const SUITES = Object.freeze({
  unit: ["npm", ["test", "--silent"]],
  adversarial: ["npm", ["run", "--silent", "test:adversarial"]],
  integration: ["npm", ["run", "--silent", "test:integration"]],
  browser: ["npm", ["run", "--silent", "test:browser", "--", "--project=w375", "--reporter=line"]]
});

/** Pure: apply a single textual mutation, refusing if the anchor is missing or ambiguous. */
export function applyMutation(source, { from, to }) {
  const first = source.indexOf(from);
  if (first < 0) return { ok: false, error: "anchor not found" };
  if (source.indexOf(from, first + 1) >= 0) return { ok: false, error: "anchor ambiguous" };
  return { ok: true, value: source.slice(0, first) + to + source.slice(first + from.length) };
}

/**
 * Pure: names of genuinely failing tests in a node:test (TAP) or Playwright line-reporter
 * output. node:test `# TODO` failures are findings, not regressions, so they are excluded.
 */
export function failingTests(output) {
  const tap = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]).filter(t => !/# TODO\b/.test(t));
  const pw = [...output.matchAll(/^\s+\d+\) (\[[^\]]+\] › .+?)(?:\s+─+)?$/gm)].map(m => m[1].trim());
  return Object.freeze([...new Set([...tap, ...pw])].sort());
}

/**
 * Pure: summarise a run DIFFERENTIALLY against the unmutated control run of the same suite.
 * A mutant is "killed" only by a failure the control did not already have, so pre-existing
 * failures on an integration tree cannot count as kills (fix round 1).
 */
export function summarise(status, output, control = { failing: [] }) {
  const num = re => Number((output.match(re) ?? [])[1] ?? NaN);
  const failing = failingTests(output);
  const newFailures = failing.filter(t => !control.failing.includes(t));
  const crashed = status !== 0 && failing.length === 0 && (control.exit ?? 0) === 0;
  return {
    exit: status,
    killed: newFailures.length > 0 || crashed,
    newFailures: newFailures.slice(0, 5),
    newFailureCount: newFailures.length,
    pass: num(/# pass (\d+)/) || num(/(\d+) passed/),
    fail: num(/# fail (\d+)/) || num(/(\d+) failed/) || 0
  };
}

function prepareCopy(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Whole tree (generated governance state included), minus VCS, dependencies and outputs.
  const SKIP = new Set([".git", "node_modules", ".aws-sam"]);
  for (const entry of readdirSync(ROOT)) {
    if (SKIP.has(entry)) continue;
    cpSync(join(ROOT, entry), join(dir, entry), { recursive: true, filter: s => !s.includes("/.output") && !s.includes("/node_modules") });
  }
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = name => process.argv.find(x => x.startsWith("--" + name + "="))?.slice(name.length + 3);
  const scratch = arg("scratch");
  if (!scratch) { process.stderr.write("--scratch=<dir> is required (never mutate the working tree)\n"); process.exit(2); }
  const suites = (arg("suites") ?? "unit,adversarial").split(",");
  const only = arg("only")?.split(",");
  const results = [];
  const runSuite = (suite, dir) => {
    const [cmd, args] = SUITES[suite];
    const run = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: 600_000, env: { ...process.env, CI: "" } });
    return { status: run.status, output: (run.stdout ?? "") + (run.stderr ?? "") };
  };
  // Control: the unmutated copy, run once per suite.
  const controlDir = join(scratch, "control");
  prepareCopy(controlDir);
  const control = Object.fromEntries(suites.map(suite => {
    const run = runSuite(suite, controlDir);
    return [suite, { exit: run.status, failing: failingTests(run.output) }];
  }));
  rmSync(controlDir, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ control }) + "\n");
  for (const mutant of MUTANTS.filter(m => !only || only.includes(m.id))) {
    const dir = join(scratch, "mutant-" + mutant.id);
    prepareCopy(dir);
    const path = join(dir, mutant.file);
    const applied = applyMutation(readFileSync(path, "utf8"), mutant);
    if (!applied.ok) { results.push({ ...mutant, error: applied.error }); continue; }
    writeFileSync(path, applied.value);
    const outcome = Object.fromEntries(suites.map(suite => {
      const run = runSuite(suite, dir);
      return [suite, summarise(run.status, run.output, control[suite])];
    }));
    const row = { id: mutant.id, guard: mutant.guard, req: mutant.req, file: mutant.file, outcome };
    results.push(row);
    process.stdout.write(JSON.stringify(row) + "\n");
    rmSync(dir, { recursive: true, force: true });
  }
  writeFileSync(join(scratch, "mutation-results.json"), JSON.stringify({ control, results }, null, 2));
}
