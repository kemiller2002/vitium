// Vitium reporter view. project(state) is pure and returns a plain, serializable
// projection (the equivalent of a Limen ViewState). applyView writes that
// projection to the document using textContent and attributes only (no HTML string injection)
// because report text is untrusted.

export const FIELD_IDS = Object.freeze({
  product: "product", impact: "impact", title: "title", actual: "actual", expected: "expected",
  steps: "steps", pageUrl: "pageUrl", privacyAcknowledged: "privacyAcknowledged"
});
export const FIELD_LABELS = Object.freeze({
  product: "Which application?", impact: "How much does it affect you?", title: "Short summary",
  actual: "What happened?", expected: "What did you expect?", steps: "How can we reproduce it?",
  pageUrl: "Page URL", privacyAcknowledged: "Privacy confirmation"
});
export const FOCUS_TARGETS = Object.freeze({
  "error-summary": "feedback", review: "review", "review-title": "review-title", "form-title": "form-title",
  "submit-error": "submit-error", "review-status": "review-status", "result-title": "success-title",
  product: "product", impact: "impact", title: "title", actual: "actual", expected: "expected",
  steps: "steps", pageUrl: "pageUrl", privacyAcknowledged: "privacyAcknowledged"
});
const OPTIONAL_FIELDS = new Set(["steps", "pageUrl"]);

export const COPY = Object.freeze({
  github: {
    privacyHeading: "Public reports",
    privacyDescription: "GitHub Issues in this repository are public. Do not include passwords, private customer data, access tokens, or sensitive screenshots.",
    reviewOverline: "Review before publishing",
    visibility: "Public. Once you submit it on GitHub, anyone can read this report.",
    retention: "Vitium has not yet published a retention and deletion policy for reports. Removing a public GitHub issue depends on the repository maintainers."
  },
  private: {
    privacyHeading: "Private reporting",
    privacyDescription: "Reports are received privately for triage. Please do not include passwords, payment data, access tokens, or sensitive personal information.",
    reviewOverline: "Review before sending",
    visibility: "Private. Only the Echelon team handling triage can see this report. It is not published to GitHub.",
    retention: "A retention period has not been decided or published yet. Do not send anything you would not want kept until that policy is published."
  }
});

const progressText = state => {
  switch (state.phase) {
    case "draft": return "Step 1 of 2 · Describe the problem";
    case "handoff-ready": return "Step 2 of 2 · Review your report";
    case "reviewing": return "Step 2 of 2 · Review your report";
    case "submitting": return "Step 2 of 2 · Sending";
    case "accepted": return "Report received";
    case "under-review": return "Report received · held for review";
    case "rejected": return "Step 2 of 2 · Not sent yet";
    default: return "";
  }
};

const preview = report => report ? {
  product: report.product, impact: report.impact, title: report.title, actual: report.actual,
  expected: report.expected, steps: report.steps, pageUrl: report.pageUrl
} : null;

function reviewStatus(state) {
  if (state.channel !== "private") return "";
  if (state.phase === "submitting") return "Sending your report… Please keep this page open.";
  if (!["reviewing", "rejected"].includes(state.phase)) return "";
  switch (state.challenge.status) {
    case "ready": return "Verification complete. Your report has not been sent yet.";
    case "unavailable": return "Verification could not load. Your report has not been sent and is still here.";
    default: return "Complete the verification below. Your report has not been sent yet.";
  }
}

/** Pure projection of state to a serializable view model. */
export function project(state) {
  const isPrivate = state.channel === "private";
  const reviewPhases = ["handoff-ready", "reviewing", "submitting", "rejected"];
  const errors = state.fieldErrors.map(e => ({
    field: e.field, controlId: e.field ? FIELD_IDS[e.field] : null, message: e.message,
    label: e.field ? FIELD_LABELS[e.field] : null
  }));
  const fieldErrors = Object.fromEntries(errors.filter(e => e.field).map(e => [e.field, e.message]));
  const copy = isPrivate ? COPY.private : COPY.github;
  const canRetry = state.phase === "rejected" && state.error?.retryable === true;
  return Object.freeze({
    channel: state.channel,
    phase: state.phase,
    progress: progressText(state),
    copy,
    formVisible: state.phase === "draft",
    values: state.values,
    errors,
    fieldErrors,
    optionalOpen: errors.some(e => OPTIONAL_FIELDS.has(e.field)) || Boolean(state.values.steps || state.values.pageUrl),
    reviewVisible: reviewPhases.includes(state.phase),
    preview: preview(state.report),
    handoffUrl: state.phase === "handoff-ready" ? state.handoffUrl : null,
    githubDestinationVisible: !isPrivate && state.phase === "handoff-ready",
    privateDestinationVisible: isPrivate && reviewPhases.includes(state.phase),
    reviewStatus: reviewStatus(state),
    submitError: state.phase === "rejected" || (state.error && state.phase === "reviewing") ? {
      message: state.error?.message ?? "", detail: state.error?.detail ?? null,
      code: state.error?.code ?? "", kind: state.error?.kind ?? ""
    } : null,
    submitVisible: isPrivate && ["reviewing", "submitting"].includes(state.phase) || canRetry,
    submitLabel: !isPrivate ? "Send" : state.phase === "submitting" ? "Sending…" : canRetry ? "Try sending again" : "Send private report",
    submitDisabled: state.phase === "submitting",
    editDisabled: state.phase === "submitting",
    busy: state.phase === "submitting",
    resultVisible: ["accepted", "under-review"].includes(state.phase),
    result: state.receipt ? {
      kind: state.phase, reference: state.receipt.reference, receivedAt: state.receipt.receivedAt,
      credentialRedacted: state.receipt.notices?.includes("credential-redacted") === true
    } : null,
    focus: state.focus,
    announcement: state.announcement
  });
}

// ---------- DOM application (the only DOM-touching code besides app.mjs) ----------

const byId = (doc, id) => doc.getElementById(id);
const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };
const setHidden = (el, hidden) => { if (el) el.hidden = hidden; };

function renderErrorSummary(doc, view) {
  const box = byId(doc, "feedback");
  const list = byId(doc, "error-list");
  if (!box || !list) return;
  setHidden(box, view.errors.length === 0);
  setText(byId(doc, "error-summary-title"),
    view.errors.length === 1 ? "There is a problem with your report" : "There are " + view.errors.length + " problems with your report");
  list.replaceChildren(...view.errors.map(error => {
    const item = doc.createElement("li");
    if (error.controlId) {
      const link = doc.createElement("a");
      link.href = "#" + error.controlId;
      link.dataset.errorFor = error.controlId;
      link.dataset.testid = "error-link-" + error.controlId;
      link.textContent = error.message;
      item.append(link);
    } else {
      item.textContent = error.message;
    }
    return item;
  }));
}

function renderFields(doc, view) {
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    const control = byId(doc, id);
    if (!control) continue;
    const message = view.fieldErrors[field] ?? "";
    const errorEl = byId(doc, id + "-error");
    setText(errorEl, message ? "Error: " + message : "");
    setHidden(errorEl, !message);
    if (message) control.setAttribute("aria-invalid", "true");
    else control.removeAttribute("aria-invalid");
    const hint = control.dataset.hint;
    const described = [hint, message ? id + "-error" : null].filter(Boolean).join(" ");
    if (described) control.setAttribute("aria-describedby", described);
    else control.removeAttribute("aria-describedby");
    control.closest(".field, .consent")?.classList.toggle("has-error", Boolean(message));
    if (field === "privacyAcknowledged") {
      if (control.checked !== view.values.privacyAcknowledged) control.checked = view.values.privacyAcknowledged;
    } else if (control.value !== view.values[field]) {
      control.value = view.values[field];
    }
  }
  const details = byId(doc, "optional-details");
  if (details && view.optionalOpen && !details.open) details.open = true;
}

function renderPreview(doc, view) {
  if (!view.preview) return;
  for (const key of ["product", "impact", "title", "actual", "expected", "steps", "pageUrl"]) {
    setText(byId(doc, "preview-" + key), view.preview[key]);
  }
  setHidden(byId(doc, "preview-steps-row"), !view.preview.steps);
  setHidden(byId(doc, "preview-url-row"), !view.preview.pageUrl);
}

/** Applies a projection. prev is the previous projection (or null) for focus/announce diffing. */
export function applyView(doc, view, prev) {
  doc.documentElement.dataset.vitiumPhase = view.phase;
  doc.documentElement.dataset.vitiumChannel = view.channel;
  setText(byId(doc, "progress"), view.progress);
  setText(byId(doc, "privacy-heading"), view.copy.privacyHeading);
  setText(byId(doc, "privacy-description"), view.copy.privacyDescription);
  setText(byId(doc, "review-overline"), view.copy.reviewOverline);
  setText(byId(doc, "visibility-notice"), view.copy.visibility);
  setText(byId(doc, "retention-notice"), view.copy.retention);

  setHidden(byId(doc, "defect-form"), !view.formVisible);
  renderErrorSummary(doc, view);
  renderFields(doc, view);

  setHidden(byId(doc, "review"), !view.reviewVisible);
  renderPreview(doc, view);
  const link = byId(doc, "submit-link");
  if (link) {
    setHidden(link, !view.githubDestinationVisible);
    if (view.handoffUrl) link.href = view.handoffUrl;
  }
  setHidden(byId(doc, "github-destination"), !view.githubDestinationVisible);
  setHidden(byId(doc, "private-destination"), !view.privateDestinationVisible);
  const status = byId(doc, "review-status");
  setText(status, view.reviewStatus);
  setHidden(status, !view.reviewStatus);
  const review = byId(doc, "review");
  if (review) review.setAttribute("aria-busy", view.busy ? "true" : "false");

  const submitError = byId(doc, "submit-error");
  setHidden(submitError, !view.submitError);
  setText(byId(doc, "submit-error-message"), view.submitError?.message ?? "");
  const detail = byId(doc, "submit-error-detail");
  setText(detail, view.submitError?.detail ? "Service detail: " + view.submitError.detail : "");
  setHidden(detail, !view.submitError?.detail);
  if (submitError) submitError.dataset.errorKind = view.submitError?.kind ?? "";

  const submit = byId(doc, "submit-private");
  if (submit) {
    setHidden(submit, !view.submitVisible);
    submit.disabled = view.submitDisabled;
    setText(byId(doc, "submit-private-label"), view.submitLabel);
  }
  for (const id of ["edit", "cancel-review"]) {
    const button = byId(doc, id);
    if (button) button.disabled = view.editDisabled;
  }

  setHidden(byId(doc, "private-success"), !view.resultVisible);
  if (view.result) {
    setText(byId(doc, "success-overline"), view.result.kind === "under-review" ? "Report received · held for review" : "Report received");
    setText(byId(doc, "result-explanation"), view.result.kind === "under-review"
      ? "We have received and stored your report privately. A person will review it before it enters triage, so it may take longer to be looked at. This does not mean the defect has been verified or fixed."
      : "We have durably received your report for triage. This does not mean the defect has been verified or fixed.");
    const notice = byId(doc, "redaction-notice");
    setHidden(notice, !view.result.credentialRedacted);
    setText(notice, view.result.credentialRedacted
      ? "Something in your report looked like a password, key or token. It was removed before your report was stored. If it was a real secret, change it now: it may have been exposed where you copied it from."
      : "");
    setText(byId(doc, "report-reference"), view.result.reference);
    setText(byId(doc, "report-received-at"), view.result.receivedAt);
  }

  const live = byId(doc, "status");
  if (live && view.announcement && (!prev || prev.announcement !== view.announcement || prev.focus.seq !== view.focus.seq)) {
    live.textContent = "";
    live.textContent = view.announcement;
  }
  if (view.focus.target && (!prev || prev.focus.seq !== view.focus.seq)) {
    const target = byId(doc, FOCUS_TARGETS[view.focus.target] ?? "");
    if (target && !target.hidden) target.focus({ preventScroll: false });
  }
}
