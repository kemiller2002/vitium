// Reducer tests for the Vitium reporter UI state machine (VIT-UX-003/004/005/007, VIT-INT-001).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialState, transition, reduce, PHASES, EMPTY_VALUES } from "../site/state.mjs";
import { INTAKE_ENDPOINT } from "../site/private-intake.mjs";

const typed = (changes = {}) => ({
  product: "Forma",
  impact: "Cannot use the feature",
  title: "  Dialog buttons stop working  ",
  actual: "The dialog button does nothing.\nTwice.",
  expected: "The dialog should close.",
  steps: "1. Open\n2. Tap Close",
  pageUrl: "https://example.com/app/page?session=SECRET-123#frag",
  privacyAcknowledged: true,
  ...changes
});
const TOKEN = "turnstile-token-0123456789";
const receipt = (changes = {}) => ({
  schemaVersion: "1.0", reference: "VIT-0123456789ABCDEF", receivedAt: "2026-10-08T10:00:00.000Z",
  status: "received", replayed: false, ...changes
});

const run = (state, ...events) => events.reduce((acc, event) => {
  const step = transition(acc.state, event);
  return { state: step.state, effects: [...acc.effects, ...step.effects] };
}, { state, effects: [] });

function reviewingPrivate(values = typed(), requestId = randomUUID()) {
  return run(initialState("private"), { type: "ReviewRequested", values, requestId });
}
function submittingPrivate(values = typed(), requestId = randomUUID()) {
  const r = run(reviewingPrivate(values, requestId).state,
    { type: "ChallengeSolved", token: TOKEN }, { type: "SubmitRequested" });
  return { ...r, requestId };
}
const httpEffect = effects => effects.find(e => e.kind === "PerformHttp");

test("initial state is an empty draft; unknown channels fail closed to GitHub", () => {
  const s = initialState();
  assert.equal(s.phase, "draft");
  assert.equal(s.channel, "github");
  assert.equal(initialState("anything").channel, "github");
  assert.deepEqual(s.values, EMPTY_VALUES);
  assert.ok(Object.isFrozen(s));
  assert.deepEqual(PHASES, ["draft", "handoff-ready", "reviewing", "submitting", "accepted", "under-review", "rejected"]);
});

test("legacy: invalid review keeps every typed value and lists all errors in form order", () => {
  const values = typed({ product: "", title: "", expected: "x".repeat(1201), privacyAcknowledged: false, pageUrl: "javascript:alert(1)" });
  const { state, effects } = run(initialState(), { type: "ReviewRequested", values });
  assert.equal(state.phase, "draft");
  assert.deepEqual(state.values, values, "typed content must be preserved exactly (VIT-UX-007)");
  assert.deepEqual(state.fieldErrors.map(e => e.field), ["product", "title", "expected", "pageUrl", "privacyAcknowledged"]);
  assert.equal(state.focus.target, "error-summary");
  assert.match(state.announcement, /5 problems/);
  assert.deepEqual(effects, []);
});

test("legacy: valid review is handoff-ready with a sanitized GitHub link, never a submitted state", () => {
  const { state, effects } = run(initialState(), { type: "ReviewRequested", values: typed() });
  assert.equal(state.phase, "handoff-ready");
  assert.equal(state.focus.target, "review");
  assert.match(state.announcement, /not been submitted/);
  const url = new URL(state.handoffUrl);
  assert.equal(url.origin + url.pathname, "https://github.com/kemiller2002/vitium/issues/new");
  assert.equal(url.searchParams.get("title"), "[Forma] Dialog buttons stop working");
  assert.doesNotMatch(state.handoffUrl, /SECRET-123|frag/);
  assert.equal(state.report.pageUrl, "https://example.com/app/page");
  assert.deepEqual(effects, [], "legacy path performs no network effect");
  assert.equal(state.receipt, null);
  // Opening GitHub is not submission.
  const opened = reduce(state, { type: "HandoffOpened" });
  assert.equal(opened.phase, "handoff-ready");
  assert.match(opened.announcement, /not submitted until you select Submit new issue/);
});

test("legacy: private-path events cannot reach accepted, even with a forged receipt", () => {
  const ready = reduce(initialState(), { type: "ReviewRequested", values: typed() });
  for (const event of [
    { type: "SubmitRequested" },
    { type: "ChallengeSolved", token: TOKEN },
    { type: "SubmitCompleted", correlationId: "x", outcome: { kind: "Success", status: 201, body: receipt() } }
  ]) {
    const next = transition(ready, event);
    assert.equal(next.state.phase, "handoff-ready");
    assert.deepEqual(next.effects, []);
  }
});

test("legacy: too-long GitHub link is a recoverable draft error with values intact", () => {
  const values = typed({ actual: "🪲".repeat(550), expected: "✔".repeat(1000), steps: "🐛".repeat(430) });
  const state = reduce(initialState(), { type: "ReviewRequested", values });
  assert.equal(state.phase, "draft");
  assert.deepEqual(state.values, values);
  assert.equal(state.fieldErrors[0].code, "handoff_too_long");
});

test("edit and cancel return to an editable draft with contents intact", () => {
  const ready = reduce(initialState(), { type: "ReviewRequested", values: typed() });
  const edited = transition(ready, { type: "EditRequested" });
  assert.equal(edited.state.phase, "draft");
  assert.deepEqual(edited.state.values, typed());
  assert.equal(edited.state.focus.target, "title");
  const cancelled = transition(ready, { type: "CancelRequested" });
  assert.equal(cancelled.state.phase, "draft");
  assert.deepEqual(cancelled.state.values, typed());
  assert.equal(cancelled.state.focus.target, "form-title");
  assert.match(cancelled.state.announcement, /Nothing was sent/);
  const priv = reviewingPrivate().state;
  const privEdit = transition(priv, { type: "EditRequested" });
  assert.deepEqual(privEdit.state.values, typed());
  assert.deepEqual(privEdit.effects, [{ kind: "ResetChallenge" }]);
});

test("field edits update one value and clear only that field's error", () => {
  const invalid = reduce(initialState(), { type: "ReviewRequested", values: typed({ title: "", actual: "" }) });
  const next = reduce(invalid, { type: "FieldChanged", field: "title", value: "New" });
  assert.equal(next.values.title, "New");
  assert.deepEqual(next.fieldErrors.map(e => e.field), ["actual"]);
  assert.equal(reduce(invalid, { type: "FieldChanged", field: "__proto__", value: "x" }), invalid);
  const ready = reduce(initialState(), { type: "ReviewRequested", values: typed() });
  assert.equal(reduce(ready, { type: "FieldChanged", field: "title", value: "changed during review" }), ready);
});

test("private: review requests the challenge and binds a single idempotency key", () => {
  const key = randomUUID();
  const { state, effects } = reviewingPrivate(typed(), key);
  assert.equal(state.phase, "reviewing");
  assert.equal(state.attempt.idempotencyKey, key);
  assert.equal(state.report.schemaVersion, "1.0");
  assert.deepEqual(effects, [{ kind: "RenderChallenge" }]);
  const bad = reduce(initialState("private"), { type: "ReviewRequested", values: typed(), requestId: "not-a-uuid" });
  assert.equal(bad.phase, "draft");
  assert.deepEqual(bad.values, typed());
});

test("over-limit typing is reported live and the text is kept, never truncated (VF-003)", () => {
  const draft = initialState();
  const long = "x".repeat(10_000);
  const next = transition(draft, { type: "FieldChanged", field: "actual", value: long });
  assert.equal(next.state.values.actual.length, 10_000);
  assert.equal(next.state.fieldErrors[0].field, "actual");
  assert.equal(next.state.fieldErrors[0].code, "too_long");
  assert.match(next.state.fieldErrors[0].message, /1,200 characters or less.*10,000.*Nothing has been cut/);
  assert.match(next.state.announcement, /1,200/);
  const fixed = reduce(next.state, { type: "FieldChanged", field: "actual", value: "short" });
  assert.deepEqual(fixed.fieldErrors, []);
  assert.match(fixed.announcement, /within the length limit/);
  // Code points, not UTF-16 units: 1,200 emoji are within the limit.
  assert.deepEqual(reduce(draft, { type: "FieldChanged", field: "actual", value: "🪲".repeat(1200) }).fieldErrors, []);
});

test("legacy: credential-looking text never reaches the public GitHub link (VF-004)", () => {
  const github = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  for (const [field, value] of [["actual", "My token is " + github], ["title", "pass" + "word: hunter2hunter2"], ["steps", "Use s" + "k-" + "x".repeat(24)]]) {
    const values = typed({ [field]: value });
    const { state, effects } = run(initialState(), { type: "ReviewRequested", values });
    assert.equal(state.phase, "draft", field);
    assert.equal(state.handoffUrl, null, field);
    assert.equal(state.fieldErrors[0].field, field);
    assert.equal(state.fieldErrors[0].code, "credential");
    assert.deepEqual(state.values, values, "typed content kept so the reporter can remove the secret");
    assert.equal(state.focus.target, "error-summary");
    assert.deepEqual(effects, []);
  }
  const session = reduce(initialState(), { type: "ReviewRequested", values: typed({ pageUrl: "https://example.com/app;jsessionid=ABCDEF123456" }) });
  assert.equal(session.fieldErrors[0].field, "pageUrl");
  assert.equal(session.fieldErrors[0].code, "credential");
});

test("private: client mirrors server credential guard before transmission", () => {
  const values = typed({ actual: "my password: hunter22 does not work" });
  const state = reduce(initialState("private"), { type: "ReviewRequested", values, requestId: randomUUID() });
  assert.equal(state.phase, "draft");
  assert.equal(state.fieldErrors[0].field, "actual");
  assert.equal(state.fieldErrors[0].code, "credential");
  assert.deepEqual(state.values, values);
});

test("private: send without a solved challenge is refused locally, no effect", () => {
  const { state } = reviewingPrivate();
  const next = transition(state, { type: "SubmitRequested" });
  assert.equal(next.state.phase, "reviewing");
  assert.deepEqual(next.effects, []);
  assert.equal(next.state.error.code, "challenge_required");
});

test("private: submit emits one typed POST with no report text in the URL and consumes the token", () => {
  const { state, effects, requestId } = submittingPrivate();
  assert.equal(state.phase, "submitting");
  assert.equal(state.challenge.token, "", "single-use token is not retained");
  const http = httpEffect(effects);
  assert.equal(http.request.method, "POST");
  assert.equal(http.request.url, INTAKE_ENDPOINT);
  assert.equal(http.request.headers["Idempotency-Key"], requestId);
  assert.equal(http.request.credentials, "omit");
  const body = JSON.parse(http.request.body);
  assert.equal(body.schemaVersion, "1.0");
  assert.equal(body.challengeToken, TOKEN);
  assert.equal(body.pageUrl, "https://example.com/app/page");
  assert.doesNotMatch(http.request.url + JSON.stringify(http.request.headers), /Dialog|SECRET|dialog/);
  // A second click while sending does nothing.
  assert.deepEqual(transition(state, { type: "SubmitRequested" }).effects, []);
});

test("accepted is reached only with a valid server receipt; the draft is cleared afterwards", () => {
  const { state, requestId } = submittingPrivate();
  const ok = transition(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 201, body: receipt() } });
  assert.equal(ok.state.phase, "accepted");
  assert.equal(ok.state.receipt.reference, "VIT-0123456789ABCDEF");
  assert.deepEqual(ok.state.values, EMPTY_VALUES);
  assert.equal(ok.state.attempt, null);
  assert.equal(ok.state.focus.target, "result-title");
  const held = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 201, body: receipt({ disposition: "quarantined", notices: ["credential-redacted", "unknown-notice"] }) } });
  assert.equal(held.phase, "under-review");
  assert.deepEqual(held.receipt.notices, ["credential-redacted"]);
  assert.match(held.announcement, /held for review before triage/);
  assert.match(held.announcement, /looked like a secret was removed/);
  // SEC-001 receipts may omit disposition entirely: that is an ordinary acceptance.
  const plain = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 201, body: receipt({ disposition: undefined }) } });
  assert.equal(plain.phase, "accepted");
  assert.deepEqual(plain.receipt.notices, []);
  const replay = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 200, body: receipt({ replayed: true }) } });
  assert.equal(replay.phase, "accepted");
});

const NON_RECEIPTS = [
  ["201 without reference", { kind: "Success", status: 201, body: receipt({ reference: undefined }) }],
  ["201 malformed reference", { kind: "Success", status: 201, body: receipt({ reference: "<img src=x>" }) }],
  ["201 wrong status word", { kind: "Success", status: 201, body: receipt({ status: "ok" }) }],
  ["201 status quarantined (not a status word)", { kind: "Success", status: 201, body: receipt({ status: "quarantined" }) }],
  ["201 unknown disposition", { kind: "Success", status: 201, body: receipt({ disposition: "published" }) }],
  ["201 inherited disposition", { kind: "Success", status: 201, body: receipt({ disposition: "constructor" }) }],
  ["201 inherited status", { kind: "Success", status: 201, body: receipt({ status: "toString" }) }],
  ["201 without receivedAt", { kind: "Success", status: 201, body: receipt({ receivedAt: undefined }) }],
  ["201 null body", { kind: "Success", status: 201, body: null }],
  ["202 with receipt", { kind: "Success", status: 202, body: receipt() }],
  ["400 echoing a receipt", { kind: "Success", status: 400, body: { ...receipt(), code: "invalid_input", message: "Choose a supported impact." } }],
  ["403 challenge_failed", { kind: "Success", status: 403, body: { code: "challenge_failed", message: "Verification failed." } }],
  ["409 request_conflict", { kind: "Success", status: 409, body: { code: "request_conflict", message: "x" } }],
  ["413", { kind: "Success", status: 413, body: null }],
  ["429", { kind: "Success", status: 429, body: null }],
  ["503 storage_unavailable", { kind: "Success", status: 503, body: { code: "storage_unavailable", message: "x" } }],
  ["500 html", { kind: "Success", status: 500, body: null }],
  ["418 unknown", { kind: "Success", status: 418, body: { code: "teapot" } }],
  ["network", { kind: "Failure", reason: "network" }],
  ["aborted", { kind: "Failure", reason: "aborted" }],
  ["invalid-response", { kind: "Failure", reason: "invalid-response" }],
  ["timeout", { kind: "OutcomeUnknown", reason: "timeout-after-dispatch" }],
  ["connection lost", { kind: "OutcomeUnknown", reason: "connection-lost" }],
  ["cancelled", { kind: "Cancelled" }],
  ["garbage", { kind: "Banana" }],
  ["undefined", undefined]
];

test("every non-receipt outcome is a typed rejection that keeps the user's content (VIT-UX-004/007, VIT-AC-004)", () => {
  for (const [name, outcome] of NON_RECEIPTS) {
    const { state, requestId } = submittingPrivate();
    const next = transition(state, { type: "SubmitCompleted", correlationId: requestId, outcome });
    assert.equal(next.state.phase, "rejected", name);
    assert.equal(next.state.receipt, null, name);
    assert.deepEqual(next.state.values, typed(), name + ": typed values preserved");
    assert.ok(next.state.report, name + ": reviewed report retained");
    assert.ok(["validation", "abuse", "throttled", "temporary", "permanent", "unavailable"].includes(next.state.error.kind), name);
    assert.equal(typeof next.state.error.message, "string");
    assert.equal(next.state.focus.target, "submit-error", name);
    assert.deepEqual(next.effects, [{ kind: "ResetChallenge" }], name);
    // Edit from any rejection returns the same content.
    assert.deepEqual(reduce(next.state, { type: "EditRequested" }).values, typed(), name);
  }
});

test("unknown outcomes are not presented as failures and retry reuses the idempotency key", () => {
  const { state, effects, requestId } = submittingPrivate();
  const first = httpEffect(effects).request.headers["Idempotency-Key"];
  const lost = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "OutcomeUnknown", reason: "timeout-after-dispatch" } });
  assert.equal(lost.error.outcomeUnknown, true);
  assert.match(lost.error.message, /could not confirm/);
  assert.equal(lost.error.retryable, true);
  // Retry needs a fresh challenge token, then reuses the same key.
  assert.deepEqual(transition(lost, { type: "SubmitRequested" }).effects, []);
  const retry = run(lost, { type: "ChallengeSolved", token: TOKEN + "b" }, { type: "SubmitRequested" });
  assert.equal(retry.state.phase, "submitting");
  assert.equal(httpEffect(retry.effects).request.headers["Idempotency-Key"], first);
  // Edit + re-review of identical content also reuses it; changed content gets a new key.
  const edited = reduce(lost, { type: "EditRequested" });
  assert.equal(reduce(edited, { type: "ReviewRequested", values: typed(), requestId: randomUUID() }).attempt.idempotencyKey, first);
  const changedKey = randomUUID();
  assert.equal(reduce(edited, { type: "ReviewRequested", values: typed({ title: "Other" }), requestId: changedKey }).attempt.idempotencyKey, changedKey);
});

test("a permanent conflict cannot be retried and forces a new key", () => {
  const { state, requestId } = submittingPrivate();
  const rejected = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 409, body: { code: "request_conflict" } } });
  assert.equal(rejected.error.retryable, false);
  assert.deepEqual(transition(reduce(rejected, { type: "ChallengeSolved", token: TOKEN }), { type: "SubmitRequested" }).effects, []);
  const fresh = randomUUID();
  const again = reduce(reduce(rejected, { type: "EditRequested" }), { type: "ReviewRequested", values: typed(), requestId: fresh });
  assert.equal(again.attempt.idempotencyKey, fresh);
});

test("validation rejections surface the server's safe detail but not unsafe text", () => {
  const { state, requestId } = submittingPrivate();
  const r = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 400, body: { code: "invalid_input", message: "Choose a supported impact." } } });
  assert.equal(r.error.kind, "validation");
  assert.equal(r.error.detail, "Choose a supported impact.");
  const r2 = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 400, body: { code: "invalid_input", message: "x".repeat(400) } } });
  assert.equal(r2.error.detail, null);
  const r3 = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 403, body: { code: "challenge_failed", message: "internal trace at line 3" } } });
  assert.equal(r3.error.detail, null, "only validation details are shown");
});

test("stale or foreign completions are ignored", () => {
  const { state } = submittingPrivate();
  const next = transition(state, { type: "SubmitCompleted", correlationId: randomUUID(), outcome: { kind: "Success", status: 201, body: receipt() } });
  assert.equal(next.state, state);
});

test("reset is only possible after acceptance and starts a clean draft", () => {
  const { state, requestId } = submittingPrivate();
  const ok = reduce(state, { type: "SubmitCompleted", correlationId: requestId, outcome: { kind: "Success", status: 201, body: receipt() } });
  const fresh = reduce(ok, { type: "ResetRequested" });
  assert.equal(fresh.phase, "draft");
  assert.deepEqual(fresh.values, EMPTY_VALUES);
  assert.equal(fresh.receipt, null);
  assert.equal(fresh.focus.target, "product");
  const draft = initialState("private");
  assert.equal(reduce(draft, { type: "ResetRequested" }), draft);
});

test("transition is pure: inputs are not mutated and results are frozen", () => {
  const { state, requestId } = submittingPrivate();
  const before = JSON.stringify(state);
  const event = Object.freeze({ type: "SubmitCompleted", correlationId: requestId, outcome: Object.freeze({ kind: "Failure", reason: "network" }) });
  const a = transition(state, event);
  const b = transition(state, event);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a.state) && Object.isFrozen(a.effects));
  assert.equal(transition(state, null).state, state);
  assert.equal(transition(state, { type: "Nope" }).state, state);
});

// Seeded exploration over every event type, including forged completions that
// lack a receipt. Invariants: accepted/under-review only with a server receipt
// matching the in-flight request; typed content is never lost before acceptance.
test("random event sequences never reach success without a receipt and never lose typed content", () => {
  let seed = 0x5eed;
  const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const outcomes = NON_RECEIPTS.map(([, o]) => o);
  for (let run = 0; run < 400; run += 1) {
    let state = initialState(rand(2) ? "private" : "github");
    let lastTyped = state.values;
    let inflight = null;
    for (let step = 0; step < 30; step += 1) {
      const choice = rand(9);
      const event = [
        () => ({ type: "ReviewRequested", values: rand(3) ? typed({ title: "t" + rand(5) }) : typed({ title: "" }), requestId: randomUUID() }),
        () => ({ type: "EditRequested" }),
        () => ({ type: "CancelRequested" }),
        () => ({ type: "ChallengeSolved", token: TOKEN }),
        () => ({ type: "ChallengeExpired" }),
        () => ({ type: "SubmitRequested" }),
        () => ({ type: "SubmitCompleted", correlationId: inflight ?? randomUUID(), outcome: outcomes[rand(outcomes.length)] }),
        () => ({ type: "FieldChanged", field: "actual", value: "typed " + rand(100) }),
        () => ({ type: "ResetRequested" })
      ][choice]();
      const { state: next, effects } = transition(state, event);
      const http = httpEffect(effects);
      if (http) inflight = http.request.correlationId;
      if (event.type === "ReviewRequested" && state.phase === "draft") lastTyped = next.values;
      if (event.type === "FieldChanged" && state.phase === "draft") lastTyped = next.values;
      assert.ok(!["accepted", "under-review"].includes(next.phase), "success without receipt: " + JSON.stringify(event));
      if (["draft", "reviewing", "rejected", "submitting", "handoff-ready"].includes(next.phase)) {
        assert.deepEqual(next.values, lastTyped, "typed content lost after " + event.type);
      }
      state = next;
    }
  }
});

test("private: blank optional fields are omitted from the request; schemaVersion is sent (VF-005)", () => {
  const { effects } = submittingPrivate(typed({ pageUrl: "", steps: "   " }));
  const body = JSON.parse(httpEffect(effects).request.body);
  assert.equal(body.schemaVersion, "1.0");
  assert.ok(!Object.hasOwn(body, "pageUrl"), "pageUrl omitted");
  assert.ok(!Object.hasOwn(body, "steps"), "steps omitted");
  assert.deepEqual(Object.keys(body).sort(), ["actual", "challengeToken", "expected", "impact", "privacyAcknowledged", "product", "schemaVersion", "title"]);
});
