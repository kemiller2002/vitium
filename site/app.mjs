import { normalizeReport, buildIssueUrl } from "./submission.mjs";

const form = document.getElementById("defect-form");
const feedback = document.getElementById("feedback");
const review = document.getElementById("review");
const progress = document.getElementById("progress");
const submitLink = document.getElementById("submit-link");

function showError(message) {
  feedback.textContent = message;
  feedback.hidden = false;
  feedback.focus();
}

function clearError() {
  feedback.textContent = "";
  feedback.hidden = true;
}

function setPreview(id, value) {
  document.getElementById("preview-" + id).textContent = value;
}

form.addEventListener("submit", event => {
  event.preventDefault();
  clearError();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  try {
    const report = normalizeReport({
      product: data.get("product"),
      impact: data.get("impact"),
      title: data.get("title"),
      actual: data.get("actual"),
      expected: data.get("expected"),
      steps: data.get("steps"),
      pageUrl: data.get("pageUrl"),
      privacyAcknowledged: document.getElementById("privacyAcknowledged").checked
    });
    const link = buildIssueUrl(report);
    for (const key of ["product", "impact", "title", "actual", "expected"]) {
      setPreview(key, report[key]);
    }
    for (const key of ["steps", "pageUrl"]) {
      setPreview(key, report[key]);
      document.getElementById("preview-" + (key === "pageUrl" ? "url" : "steps") + "-row").hidden = !report[key];
    }
    submitLink.href = link;
    form.hidden = true;
    review.hidden = false;
    progress.textContent = "Step 2 of 2 · Review your report";
    review.focus();
  } catch (error) {
    showError(error instanceof Error ? error.message : "We couldn't prepare your report. Please try again.");
  }
});

document.getElementById("edit").addEventListener("click", () => {
  clearError();
  review.hidden = true;
  form.hidden = false;
  progress.textContent = "Step 1 of 2 · Describe the problem";
  document.getElementById("title").focus();
});
