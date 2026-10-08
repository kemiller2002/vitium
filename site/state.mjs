// Vitium reporter UI state machine (VIT-UX-003/004/005/007, VIT-INT-001).
//
// Pure: no DOM, network, timers, randomness or storage. Shaped like a Limen
// engine so it can be ported 1:1 to F#: transition(state, event) returns the next
// state and a list of effect requests; the host performs them and feeds results
// back as events. See docs/ux/LIMEN-MIGRATION-PLAN.md.
//
// Phases
//   draft          editable form (both channels)
//   handoff-ready  legacy GitHub path: review shown, link to GitHub prefilled.
//                  Terminal for Vitium: GitHub is the only authority to submit.
//   reviewing      private path: review shown, challenge pending/solved
//   submitting     private path: request in flight
//   accepted       private path: ONLY after a validated server receipt (status received)
//   under-review   private path: ONLY after a validated server receipt (quarantined)
//   rejected       private path: typed error; values and request id retained
import { validateReport, tryBuildIssueUrl, FIELD_ORDER } from "./submission.mjs";
import {
  validatePrivateReport, buildPrivateRequest, classifyOutcome, parseReceipt,
  IDEMPOTENCY_KEY_PATTERN
} from "./private-intake.mjs";

export const PHASES = Object.freeze([
  "draft", "handoff-ready", "reviewing", "submitting", "accepted", "under-review", "rejected"
]);
export const TEXT_FIELDS = Object.freeze(["product", "impact", "title", "actual", "expected", "steps", "pageUrl"]);
export const EMPTY_VALUES = Object.freeze({
  product: "", impact: "", title: "", actual: "", expected: "", steps: "", pageUrl: "", privacyAcknowledged: false
});

const freeze = Object.freeze;
const NO_EFFECTS = freeze([]);

export function initialState(channel = "github") {
  return freeze({
    channel: channel === "private" ? "private" : "github",
    phase: "draft",
    values: EMPTY_VALUES,
    fieldErrors: freeze([]),
    report: null,
    handoffUrl: null,
    attempt: null,          // { idempotencyKey, fingerprint } — reused on retry
    challenge: freeze({ status: "idle", token: "" }),
    receipt: null,
    error: null,            // typed rejection or local notice
    focus: freeze({ target: null, seq: 0 }),
    announcement: ""
  });
}

const focusOn = (state, target) => freeze({ target, seq: state.focus.seq + 1 });
const update = (state, changes) => freeze({ ...state, ...changes });
const result = (state, effects = NO_EFFECTS) => freeze({ state, effects: freeze(effects) });
const unchanged = state => result(state);

function mergeValues(values, incoming) {
  if (!incoming || typeof incoming !== "object") return values;
  const next = { ...values };
  for (const field of TEXT_FIELDS) {
    if (Object.hasOwn(incoming, field)) next[field] = String(incoming[field] ?? "");
  }
  if (Object.hasOwn(incoming, "privacyAcknowledged")) next.privacyAcknowledged = incoming.privacyAcknowledged === true;
  return freeze(next);
}

const firstFieldTarget = errors => {
  const fieldErr = errors.find(e => e.field);
  return fieldErr ? fieldErr.field : null;
};

function showDraftErrors(state, values, errors) {
  return result(update(state, {
    phase: "draft", values, fieldErrors: freeze([...errors]), report: null, handoffUrl: null,
    error: null,
    focus: focusOn(state, "error-summary"),
    announcement: errors.length === 1
      ? "There is 1 problem with your report."
      : "There are " + errors.length + " problems with your report."
  }));
}

function requestReview(state, event) {
  if (state.phase !== "draft") return unchanged(state);
  const values = mergeValues(state.values, event.values);
  if (state.channel === "github") {
    const checked = validateReport(values);
    if (!checked.ok) return showDraftErrors(state, values, checked.errors);
    const link = tryBuildIssueUrl(checked.value);
    if (!link.ok) return showDraftErrors(state, values, [link.error]);
    return result(update(state, {
      phase: "handoff-ready", values, fieldErrors: freeze([]), report: checked.value,
      handoffUrl: link.value, error: null,
      focus: focusOn(state, "review-title"),
      announcement: "Review your report. It has not been submitted."
    }));
  }
  const checked = validatePrivateReport(values);
  if (!checked.ok) return showDraftErrors(state, values, checked.errors);
  const fingerprint = JSON.stringify(checked.value);
  // Same content as an earlier (possibly delivered) attempt: reuse its key so the
  // server deduplicates. Changed content: a fresh key from the host.
  const reuse = state.attempt && state.attempt.fingerprint === fingerprint;
  const key = reuse ? state.attempt.idempotencyKey : event.requestId;
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return showDraftErrors(state, values, [freeze({ field: null, code: "invalid_request_id", message: "We could not prepare your report. Please try again." })]);
  }
  return result(update(state, {
    phase: "reviewing", values, fieldErrors: freeze([]), report: checked.value, handoffUrl: null,
    attempt: freeze({ idempotencyKey: key, fingerprint }),
    challenge: freeze({ status: "pending", token: "" }),
    error: null,
    focus: focusOn(state, "review-title"),
    announcement: "Review your report. It has not been sent."
  }), [freeze({ kind: "RenderChallenge" })]);
}

function editRequested(state, focusTarget = "title") {
  if (!["handoff-ready", "reviewing", "rejected"].includes(state.phase)) return unchanged(state);
  const effects = state.channel === "private" ? [freeze({ kind: "ResetChallenge" })] : [];
  return result(update(state, {
    phase: "draft", report: null, handoffUrl: null, error: null, fieldErrors: freeze([]),
    challenge: freeze({ status: "idle", token: "" }),
    // attempt is kept so re-reviewing identical content reuses the idempotency key
    // (safe retry after an unknown outcome), unless the server said the key is spent.
    attempt: state.error?.action === "start-new" ? null : state.attempt,
    focus: focusOn(state, focusTarget),
    announcement: focusTarget === "title"
      ? "Editing your report. Your answers are kept."
      : "Review cancelled. Nothing was sent. Your answers are kept."
  }), effects);
}

function challengeSolved(state, event) {
  if (state.channel !== "private" || !["reviewing", "rejected"].includes(state.phase)) return unchanged(state);
  if (typeof event.token !== "string" || event.token.length === 0) return unchanged(state);
  return result(update(state, {
    challenge: freeze({ status: "ready", token: event.token }),
    announcement: "Verification complete. You can send your report."
  }));
}

function challengeLost(state, status) {
  if (state.channel !== "private" || !["reviewing", "rejected"].includes(state.phase)) return unchanged(state);
  return result(update(state, {
    challenge: freeze({ status, token: "" }),
    announcement: status === "unavailable"
      ? "Verification could not load. Your report is still here; try again later."
      : "Verification expired. Complete it again before sending."
  }));
}

function submitRequested(state) {
  if (state.channel !== "private") return unchanged(state);
  const canSend = state.phase === "reviewing" || (state.phase === "rejected" && state.error?.retryable === true);
  if (!canSend || !state.report || !state.attempt) return unchanged(state);
  const notice = (code, message) => result(update(state, {
    error: freeze({ kind: "local", code, action: "verify-retry", message, retryable: state.phase === "rejected" ? true : false, outcomeUnknown: false, detail: null, local: true }),
    focus: focusOn(state, "submit-error"),
    announcement: message
  }));
  if (state.challenge.status !== "ready" || !state.challenge.token) {
    return notice("challenge_required", "Complete the verification before sending.");
  }
  const request = buildPrivateRequest({
    report: state.report, idempotencyKey: state.attempt.idempotencyKey, challengeToken: state.challenge.token
  });
  if (!request.ok) return notice(request.error.code, request.error.message);
  return result(update(state, {
    phase: "submitting", error: null,
    // A challenge token is single-use; it is consumed by this attempt.
    challenge: freeze({ status: "consumed", token: "" }),
    focus: focusOn(state, "review-status"),
    announcement: "Sending your report…"
  }), [freeze({ kind: "PerformHttp", request: request.value })]);
}

function submitCompleted(state, event) {
  if (state.phase !== "submitting" || !state.attempt) return unchanged(state);
  // Stale or foreign results are ignored (correlation = idempotency key).
  if (event.correlationId !== state.attempt.idempotencyKey) return unchanged(state);
  const outcome = classifyOutcome(event.outcome);
  const resetChallenge = freeze({ kind: "ResetChallenge" });
  if ((outcome.kind === "accepted" || outcome.kind === "under-review") && outcome.receipt) {
    // Defence in depth: re-validate the receipt from the raw outcome.
    const receipt = parseReceipt(event.outcome?.status, event.outcome?.body);
    if (!receipt || receipt.reference !== outcome.receipt.reference) return unchanged(state);
    return result(update(state, {
      phase: outcome.kind,
      // The draft must not persist after authoritative acceptance.
      values: EMPTY_VALUES, report: null, attempt: null,
      challenge: freeze({ status: "idle", token: "" }),
      receipt, error: null,
      focus: focusOn(state, "result-title"),
      announcement: outcome.kind === "accepted"
        ? "Report received. Your reference is " + receipt.reference + "."
        : "Report received and held for review. Your reference is " + receipt.reference + "."
    }));
  }
  const error = outcome.error;
  return result(update(state, {
    phase: "rejected",
    error,
    challenge: freeze({ status: error.retryable ? "pending" : "idle", token: "" }),
    focus: focusOn(state, "submit-error"),
    announcement: error.message
  }), [resetChallenge]);
}

function resetRequested(state) {
  if (!["accepted", "under-review"].includes(state.phase)) return unchanged(state);
  const fresh = initialState(state.channel);
  return result(update(fresh, { focus: focusOn(state, "product"), announcement: "Started a new report." }));
}

function fieldChanged(state, event) {
  if (state.phase !== "draft") return unchanged(state);
  if (event.field !== "privacyAcknowledged" && !TEXT_FIELDS.includes(event.field)) return unchanged(state);
  const values = mergeValues(state.values, { [event.field]: event.value });
  // Clear the stale error for the edited field only; keep the rest visible.
  const fieldErrors = freeze(state.fieldErrors.filter(e => e.field !== event.field));
  return result(update(state, { values, fieldErrors }));
}

function handoffOpened(state) {
  if (state.phase !== "handoff-ready") return unchanged(state);
  return result(update(state, {
    announcement: "GitHub opened in a new tab. Your report is not submitted until you select Submit new issue on GitHub."
  }));
}

/**
 * @param state  current state (from initialState / previous transition)
 * @param event  { type: "FieldChanged"|"ReviewRequested"|"EditRequested"|"CancelRequested"|"ChallengeSolved"|
 *                 "ChallengeExpired"|"ChallengeUnavailable"|"SubmitRequested"|"SubmitCompleted"|
 *                 "ResetRequested"|"HandoffOpened", ... }
 * @returns {{state, effects}}
 */
export function transition(state, event) {
  if (!event || typeof event.type !== "string") return unchanged(state);
  switch (event.type) {
    case "FieldChanged": return fieldChanged(state, event);
    case "ReviewRequested": return requestReview(state, event);
    case "EditRequested": return editRequested(state, "title");
    case "CancelRequested": return editRequested(state, "form-title");
    case "ChallengeSolved": return challengeSolved(state, event);
    case "ChallengeExpired": return challengeLost(state, "pending");
    case "ChallengeUnavailable": return challengeLost(state, "unavailable");
    case "SubmitRequested": return submitRequested(state);
    case "SubmitCompleted": return submitCompleted(state, event);
    case "ResetRequested": return resetRequested(state);
    case "HandoffOpened": return handoffOpened(state);
    default: return unchanged(state);
  }
}

/** reduce(state, event) -> state (effects discarded). */
export const reduce = (state, event) => transition(state, event).state;

export const fieldOrder = FIELD_ORDER;
