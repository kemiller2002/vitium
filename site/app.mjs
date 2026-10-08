import { normalizeReport, buildIssueUrl } from "./submission.mjs";
import { publicIntake } from "./public-config.mjs";

const form = document.getElementById("defect-form");
const feedback = document.getElementById("feedback");
const review = document.getElementById("review");
const progress = document.getElementById("progress");
const submitLink = document.getElementById("submit-link");
const submitPrivate = document.getElementById("submit-private");
const success = document.getElementById("private-success");

const privateConfigured = publicIntake.enabled === true &&
  publicIntake.endpoint === "https://intake.vitium.echelonfoundry.com/api/v1/reports" &&
  typeof publicIntake.turnstileSiteKey === "string" &&
  /^[A-Za-z0-9_-]{10,120}$/.test(publicIntake.turnstileSiteKey);

let draft = null;
let requestId = null;
let challengeToken = "";
let widgetId = null;
let sending = false;

function showError(message) {
  feedback.textContent = message;
  feedback.hidden = false;
  feedback.focus();
}
function clearError() { feedback.textContent = ""; feedback.hidden = true; }
function setPreview(id, value) { document.getElementById("preview-" + id).textContent = value; }

if (privateConfigured) {
  document.getElementById("github-foot").hidden = true;
  document.getElementById("private-foot").hidden = false;
  document.getElementById("privacy-heading").textContent = "Private reporting";
  document.getElementById("privacy-description").textContent =
    "Reports are received privately for triage. Please do not include passwords, payment data, access tokens, or sensitive personal information.";
  document.getElementById("review-overline").textContent = "Review before sending";
  document.getElementById("github-destination").hidden = true;
  document.getElementById("private-destination").hidden = false;
  submitLink.hidden = true;
  submitPrivate.hidden = false;
  document.querySelector(".nav-link").hidden = true;
}

async function setupChallenge() {
  if (!privateConfigured) return;
  if (window.turnstile && widgetId !== null) return;
  if (!window.turnstile) {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    document.head.appendChild(script);
    await new Promise((resolve,reject)=>{
      script.addEventListener("load",resolve,{once:true});
      script.addEventListener("error",()=>reject(new Error("Verification failed to load. Please try again.")),{once:true});
    });
  }
  if (!window.turnstile) throw new Error("Verification is currently unavailable.");
  if (widgetId !== null) return;
  widgetId=window.turnstile.render("#turnstile-challenge",{
    sitekey:publicIntake.turnstileSiteKey,
    action:"vitium-intake",
    callback:token=>{challengeToken=token;},
    "expired-callback":()=>{challengeToken="";},
    "error-callback":()=>{challengeToken="";}
  });
}
function resetChallenge() {
  challengeToken="";
  if (window.turnstile && widgetId!==null) window.turnstile.reset(widgetId);
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  clearError();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  try {
    draft=normalizeReport({
      product:data.get("product"),
      impact:data.get("impact"),
      title:data.get("title"),
      actual:data.get("actual"),
      expected:data.get("expected"),
      steps:data.get("steps"),
      pageUrl:data.get("pageUrl"),
      privacyAcknowledged:document.getElementById("privacyAcknowledged").checked
    });
    if (!privateConfigured) submitLink.href = buildIssueUrl(draft);
    for (const key of ["product","impact","title","actual","expected"]) setPreview(key,draft[key]);
    for (const key of ["steps","pageUrl"]) {
      setPreview(key,draft[key]);
      document.getElementById("preview-" + (key==="pageUrl"?"url":"steps") + "-row").hidden = !draft[key];
    }
    requestId=crypto.randomUUID();
    form.hidden = true;
    review.hidden = false;
    progress.textContent = "Step 2 of 2 · Review your report";
    review.focus();
    if (privateConfigured) {
      try { await setupChallenge(); }
      catch(error){ showError(error instanceof Error?error.message:"Verification is unavailable."); }
    }
  } catch(error) {
    showError(error instanceof Error?error.message:"We couldn't prepare your report. Please try again.");
  }
});
document.getElementById("edit").addEventListener("click",()=>{
  if (sending) return;
  clearError();
  review.hidden=true;
  form.hidden=false;
  draft=null;
  requestId=null;
  resetChallenge();
  progress.textContent="Step 1 of 2 · Describe the problem";
  document.getElementById("title").focus();
});
submitPrivate.addEventListener("click",async()=>{
  if (!privateConfigured || !draft || sending) return;
  clearError();
  if (!challengeToken) {
    showError("Complete the verification challenge before sending.");
    return;
  }
  sending=true;
  submitPrivate.disabled=true;
  submitPrivate.textContent="Sending…";
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const resp=await fetch(publicIntake.endpoint,{
      method:"POST",
      mode:"cors",
      headers:{"Content-Type":"application/json","Idempotency-Key":requestId},
      body:JSON.stringify({...draft,privacyAcknowledged:true,challengeToken}),
      signal:controller.signal,
      cache:"no-store"
    });
    let body;
    try { body=await resp.json(); } catch { body=null; }
    if (!resp.ok) {
      throw new Error(body?.message && typeof body.message==="string" ? body.message : "The report could not be accepted. Please retry.");
    }
    if (!body || body.status!=="received" || typeof body.reference!=="string" || !/^VIT-[A-Za-z0-9-]{8,}$/.test(body.reference)) {
      throw new Error("The service did not confirm receipt. Please retry.");
    }
    review.hidden=true;
    success.hidden=false;
    document.getElementById("report-reference").textContent=body.reference;
    progress.textContent="Report received";
    // In-memory draft must not persist after acceptance.
    draft=null;
    requestId=null;
    success.focus();
  } catch(error) {
    showError(error instanceof Error?error.message:"The report could not be sent. Please retry.");
  } finally {
    clearTimeout(timeout);
    sending=false;
    submitPrivate.disabled=false;
    submitPrivate.textContent="Send private report →";
    resetChallenge(); // A one-time challenge token cannot be reused after failure.
  }
});
document.getElementById("report-another").addEventListener("click",()=>{
  clearError();
  form.reset();
  success.hidden=true;
  form.hidden=false;
  review.hidden=true;
  draft=null;
  requestId=null;
  progress.textContent="Step 1 of 2 · Describe the problem";
  document.getElementById("product").focus();
});
