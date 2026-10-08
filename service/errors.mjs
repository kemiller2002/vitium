// Typed intake outcomes (VIT-API-005). Expected failures are values, never exceptions.
// Every failure has a stable machine code, one of six categories, an HTTP status, a
// retry hint and a reporter-safe message. Messages never contain reporter content,
// provider responses or infrastructure detail.

export const categories = Object.freeze(["validation","abuse","throttled","temporary","permanent","unavailable"]);

export const ok = value => Object.freeze({ok:true,value});
export const fail = error => Object.freeze({ok:false,error});

const catalog = Object.freeze({
  invalid_input:        {category:"validation", status:400, retryable:false, message:"The report is not valid."},
  invalid_json:         {category:"validation", status:400, retryable:false, message:"The report must contain valid JSON."},
  invalid_content_type: {category:"validation", status:415, retryable:false, message:"Send JSON."},
  payload_too_large:    {category:"validation", status:413, retryable:false, message:"The report is too large."},
  invalid_request_id:   {category:"validation", status:400, retryable:false, message:"A valid request identifier is required."},
  origin_denied:        {category:"abuse",      status:403, retryable:false, message:"This origin is not allowed."},
  challenge_required:   {category:"abuse",      status:403, retryable:true,  message:"Please complete the verification challenge."},
  challenge_failed:     {category:"abuse",      status:403, retryable:true,  message:"Verification failed. Please complete a new challenge and try again."},
  throttled:            {category:"throttled",  status:429, retryable:true,  message:"Too many reports are being sent right now. Please wait a minute and retry."},
  challenge_unavailable:{category:"temporary",  status:503, retryable:true,  message:"Verification is temporarily unavailable. Please retry."},
  storage_unavailable:  {category:"temporary",  status:503, retryable:true,  message:"The report could not be saved. Please retry."},
  request_conflict:     {category:"permanent",  status:409, retryable:false, message:"This request identifier was used for different report content. Please start a new submission."},
  not_found:            {category:"permanent",  status:404, retryable:false, message:"This operation is unavailable."},
  service_unavailable:  {category:"unavailable",status:503, retryable:true,  message:"Reporting is temporarily unavailable."}
});

/** Build a typed failure. `detail` is an optional reporter-safe message override (validation only). */
export function intakeFailure(code, detail) {
  const entry = catalog[code] ?? catalog.service_unavailable;
  const known = catalog[code] ? code : "service_unavailable";
  const message = entry.category === "validation" && typeof detail === "string" && detail ? detail : entry.message;
  return Object.freeze({code:known, category:entry.category, status:entry.status, retryable:entry.retryable, message});
}

/** Public wire shape of a failure: nothing beyond the catalog fields. */
export const failureBody = error =>
  ({code:error.code, category:error.category, retryable:error.retryable, message:error.message});
