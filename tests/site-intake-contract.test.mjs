// Client/server private intake contract (VIT-API-001 client side, VIT-AC-003/004).
// The site mirrors server limits instead of importing service/ at runtime (Pages
// serves only site/). These tests IMPORT the service's single sources of truth
// (service/limits.mjs, service/errors.mjs; fix-round-1 contract) and fail on drift.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as server from "../service/report-domain.mjs";
import { INTAKE_LIMITS } from "../service/limits.mjs";
import { ERROR_CODES, intakeFailure } from "../service/errors.mjs";
import { makeIntake } from "../service/intake.mjs";
import { createHttpHandler } from "../service/http.mjs";
import { publicIntake } from "../site/public-config.mjs";
import {
  PRIVATE_LIMITS, REQUEST_FIELDS, SCHEMA_VERSION, INTAKE_ENDPOINT, ERROR_CATALOGUE,
  IDEMPOTENCY_KEY_PATTERN, validatePrivateReport, buildPrivateRequest, classifyOutcome,
  resolveChannel, parseReceipt, makeHttpPerformer
} from "../site/private-intake.mjs";
import { initialState, transition } from "../site/state.mjs";

const typed = (changes = {}) => ({
  product: "Forma", impact: "Not sure", title: "Broken dialog", actual: "Nothing happens.",
  expected: "It closes.", steps: "", pageUrl: "", privacyAcknowledged: true, ...changes
});
const serverAccepts = raw => { try { server.normalizeReport(raw); return true; } catch { return false; } };
// The wire body omits blank optional fields, exactly as the client does (VF-005).
const wire = (changes = {}) => {
  const body = { schemaVersion: "1.0", ...typed(), ...changes };
  for (const field of ["steps", "pageUrl"]) if (body[field] === "") delete body[field];
  return body;
};

test("the private channel stays disabled and fails closed for incomplete configuration", () => {
  assert.equal(publicIntake.enabled, false);
  assert.equal(resolveChannel(publicIntake), "github");
  for (const config of [
    null, {}, { enabled: true }, { enabled: "true", endpoint: INTAKE_ENDPOINT, turnstileSiteKey: "0x4AAAAAAAAbcdefgh" },
    { enabled: true, endpoint: "http://intake.vitium.echelonfoundry.com/api/v1/reports", turnstileSiteKey: "0x4AAAAAAAAbcdefgh" },
    { enabled: true, endpoint: INTAKE_ENDPOINT + "?x=1", turnstileSiteKey: "0x4AAAAAAAAbcdefgh" },
    { enabled: true, endpoint: INTAKE_ENDPOINT, turnstileSiteKey: "short" },
    { enabled: true, endpoint: INTAKE_ENDPOINT, turnstileSiteKey: "<script>alert(1)</script>" }
  ]) assert.equal(resolveChannel(config), "github", JSON.stringify(config));
  assert.equal(resolveChannel({ enabled: true, endpoint: INTAKE_ENDPOINT, turnstileSiteKey: "0x4AAAAAAAAbcdefgh" }), "private");
});

test("client field limits equal the server's, probed at the boundary", () => {
  for (const field of ["title", "actual", "expected", "steps"]) {
    const max = PRIVATE_LIMITS[field];
    assert.equal(serverAccepts(wire({ [field]: "a".repeat(max) })), true, field + " at limit");
    assert.equal(serverAccepts(wire({ [field]: "a".repeat(max + 1) })), false, field + " over limit");
    assert.equal(validatePrivateReport(typed({ [field]: "a".repeat(max) })).ok, true, field + " client at limit");
    assert.equal(validatePrivateReport(typed({ [field]: "a".repeat(max + 1) })).ok, false, field + " client over limit");
  }
  const url = "https://example.com/" + "p".repeat(PRIVATE_LIMITS.pageUrl - 20);
  assert.equal(url.length, PRIVATE_LIMITS.pageUrl);
  assert.equal(serverAccepts(wire({ pageUrl: url })), true);
  assert.equal(serverAccepts(wire({ pageUrl: url + "p" })), false);
  assert.equal(validatePrivateReport(typed({ pageUrl: url + "p" })).ok, false);
});

test("client mirrors the server's schema version, allowed fields, products, impacts and body/key/token limits", () => {
  assert.equal(SCHEMA_VERSION, "1.0");
  assert.equal(serverAccepts(wire({ schemaVersion: "1.1" })), false);
  assert.equal(serverAccepts(wire({ unexpected: 1 })), false);
  for (const field of REQUEST_FIELDS) {
    assert.equal(serverAccepts(wire({ [field]: field === "privacyAcknowledged" ? true : field === "schemaVersion" ? "1.0" : field === "product" ? "Forma" : field === "impact" ? "Not sure" : field === "pageUrl" ? "https://example.com/" : "ok" })), true, field + " allowed");
  }
  // Single source of truth: service/limits.mjs.
  assert.equal(SCHEMA_VERSION, INTAKE_LIMITS.schemaVersion);
  assert.equal(PRIVATE_LIMITS.bodyBytes, INTAKE_LIMITS.maxBodyBytes);
  assert.equal(PRIVATE_LIMITS.bodyBytes, 24576);
  assert.equal(PRIVATE_LIMITS.challengeTokenMax, INTAKE_LIMITS.maxChallengeTokenChars);
  assert.equal(PRIVATE_LIMITS.challengeTokenMin, INTAKE_LIMITS.minChallengeTokenChars ?? 12);
  assert.equal(INTAKE_LIMITS.idempotencyKey, "uuid-v4");
  for (let i = 0; i < 50; i += 1) {
    const key = randomUUID();
    assert.ok(IDEMPOTENCY_KEY_PATTERN.test(key));
    assert.doesNotThrow(() => server.assertIdempotencyKey(key));
  }
  for (const key of ["", "abc", "00000000-0000-0000-0000-000000000000", randomUUID() + "x"]) {
    assert.equal(IDEMPOTENCY_KEY_PATTERN.test(key), false, key);
    assert.throws(() => server.assertIdempotencyKey(key));
  }
});

test("client credential and control-character guards agree with the server", () => {
  for (const text of [
    // Credential-shaped canaries are assembled at runtime so the committed file holds
    // no literal that the repository secret scanner would flag.
    ["pass", "word: hunter22"].join(""), ["api", "_key = abcd1234"].join(""), "gh" + "p_" + "a".repeat(20),
    "s" + "k-" + "b".repeat(20), ["-----BEGIN", "PRIVATE KEY-----"].join(" "), "bad\u0007bell"
  ]) {
    assert.equal(serverAccepts(wire({ actual: text })), false, text);
    assert.equal(validatePrivateReport(typed({ actual: text })).ok, false, text);
  }
  for (const text of ["My password reset email never arrives", "multi\nline\r\ntext\ttab"]) {
    assert.equal(serverAccepts(wire({ actual: text })), true, text);
    assert.equal(validatePrivateReport(typed({ actual: text })).ok, true, text);
  }
});

test("every service ERROR_CODES entry maps to an actionable client error with matching category and retry hint", () => {
  assert.ok(Array.isArray(ERROR_CODES) && Object.isFrozen(ERROR_CODES) && ERROR_CODES.length >= 10);
  assert.deepEqual(Object.keys(ERROR_CATALOGUE).sort(), [...ERROR_CODES].sort(), "client catalogue and service ERROR_CODES must be the same set");
  for (const code of ERROR_CODES) {
    const service = intakeFailure(code);
    const entry = ERROR_CATALOGUE[code];
    assert.equal(service.code, code, "service knows " + code);
    assert.equal(entry.kind, service.category, code + " category");
    assert.ok(["edit", "verify-retry", "start-new", "none"].includes(entry.action), code);
    assert.equal(entry.action === "verify-retry", service.retryable, code + ": client retry offer must equal the service retry hint");
    assert.ok(entry.message.length > 20 && !/undefined|null|\{/.test(entry.message), code);
    // Every message tells the reporter what to do or what state their report is in.
    assert.match(entry.message, /\b(edit|review|try|complete|wait|shorten|check|not been sent|still here|not available)\b/i, code + " is actionable");
    const classified = classifyOutcome({ kind: "Success", status: service.status, body: { code, category: service.category, retryable: service.retryable, message: service.message } });
    assert.equal(classified.kind, "rejected");
    assert.equal(classified.error.code, code);
    assert.equal(classified.error.retryable, service.retryable, code);
  }
});

// An in-memory store is enough for contract shape; it is NOT evidence of durable
// or concurrent storage behaviour.
function serverHarness({ verify = async () => true, fail = false } = {}) {
  const items = new Map();
  const store = {
    async putOnce(item) {
      if (fail) throw new Error("down");
      if (items.has(item.pk)) return { created: false, existing: items.get(item.pk) };
      items.set(item.pk, item); return { created: true };
    }
  };
  const handle = createHttpHandler(makeIntake({ store, verifyChallenge: verify }));
  const perform = async request => {
    const response = await handle({
      headers: { origin: "https://vitium.echelonfoundry.com", ...Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])) },
      requestContext: { http: { method: request.method } },
      rawPath: new URL(request.url).pathname,
      body: request.body
    });
    return { kind: "Success", status: response.statusCode, body: JSON.parse(response.body) };
  };
  return { perform, items };
}

async function drive(harness, values = typed(), token = "challenge-token-0123456789") {
  let { state } = transition(initialState("private"), { type: "ReviewRequested", values, requestId: randomUUID() });
  state = transition(state, { type: "ChallengeSolved", token }).state;
  const sent = transition(state, { type: "SubmitRequested" });
  const http = sent.effects.find(e => e.kind === "PerformHttp");
  assert.ok(http, "expected a request; state=" + sent.state.phase + " " + JSON.stringify(sent.state.error));
  const outcome = await harness.perform(http.request);
  return { request: http.request, outcome, state: transition(sent.state, { type: "SubmitCompleted", correlationId: http.request.correlationId, outcome }).state };
}

test("round trip: blank optional fields are omitted and the real server accepts the request (VF-005)", async () => {
  const harness = serverHarness();
  const { state, request } = await drive(harness, typed({ steps: "", pageUrl: "" }));
  const body = JSON.parse(request.body);
  assert.ok(!Object.hasOwn(body, "pageUrl") && !Object.hasOwn(body, "steps"));
  assert.equal(body.schemaVersion, "1.0");
  assert.equal(state.phase, "accepted");
});

test("round trip: a client-built request is accepted by the real server handler and yields a receipt", async () => {
  const harness = serverHarness();
  const { state, outcome, request } = await drive(harness, typed({ pageUrl: "https://example.com/a?token=SECRET#x", steps: "1. a\n2. b" }));
  assert.equal(outcome.status, 201);
  assert.equal(state.phase, "accepted");
  assert.match(state.receipt.reference, /^VIT-[0-9A-F]{32}$/);
  const stored = [...harness.items.values()][0];
  assert.equal(stored.report.pageUrl, "https://example.com/a");
  assert.equal(stored.report.steps, "1. a\n2. b");
  assert.doesNotMatch(request.url, /SECRET|example\.com/);
  // Replay with the same key returns the same reference (safe retry).
  const replay = await harness.perform(request);
  assert.equal(replay.status, 200);
  assert.equal(parseReceipt(replay.status, replay.body).reference, state.receipt.reference);
  assert.equal(harness.items.size, 1);
});

test("round trip: server rejections become typed client errors with content preserved", async () => {
  const cases = [
    [serverHarness({ verify: async () => false }), "abuse", "challenge_failed"],
    [serverHarness({ verify: async () => { throw new Error("x"); } }), "temporary", "challenge_unavailable"],
    [serverHarness({ fail: true }), "temporary", "storage_unavailable"]
  ];
  for (const [harness, kind, code] of cases) {
    const { state } = await drive(harness);
    assert.equal(state.phase, "rejected", code);
    assert.equal(state.error.kind, kind, code);
    assert.equal(state.error.code, code);
    assert.deepEqual(state.values, typed(), code);
  }
});

test("request builder refuses unapproved endpoints, bad keys, bad tokens and oversize bodies", () => {
  const report = validatePrivateReport(typed()).value;
  const key = randomUUID();
  const token = "challenge-token-0123456789";
  assert.equal(buildPrivateRequest({ report, idempotencyKey: key, challengeToken: token }).ok, true);
  assert.equal(buildPrivateRequest({ report, idempotencyKey: key, challengeToken: token, endpoint: "https://evil.example/api/v1/reports" }).ok, false);
  assert.equal(buildPrivateRequest({ report, idempotencyKey: "nope", challengeToken: token }).ok, false);
  assert.equal(buildPrivateRequest({ report, idempotencyKey: key, challengeToken: "short" }).ok, false);
  assert.equal(buildPrivateRequest({ report, idempotencyKey: key, challengeToken: "t".repeat(4097) }).ok, false);
  // Largest valid report (3-byte characters at every limit) plus the largest permitted
  // challenge token fits the 24 KiB body cap (UX defect #2 closed by INTAKE_LIMITS).
  const largest = validatePrivateReport(typed({ title: "✔".repeat(120), actual: "✔".repeat(1200), expected: "✔".repeat(1200), steps: "✔".repeat(900), pageUrl: "https://example.com/" + "p".repeat(1980) }));
  assert.equal(largest.ok, true);
  const maxed = buildPrivateRequest({ report: largest.value, idempotencyKey: key, challengeToken: "t".repeat(INTAKE_LIMITS.maxChallengeTokenChars) });
  assert.equal(maxed.ok, true);
  assert.ok(new TextEncoder().encode(maxed.value.body).length <= INTAKE_LIMITS.maxBodyBytes);
  // The byte guard itself (defence in depth for a report built outside validation).
  const big = Object.freeze({ ...report, actual: "✔".repeat(9000) });
  const r = buildPrivateRequest({ report: big, idempotencyKey: key, challengeToken: token });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "payload_too_large");
});

test("HTTP performer maps thrown POSTs to OutcomeUnknown and offline to network failure", async () => {
  const timers = { setTimer: () => 1, clearTimer: () => {} };
  const request = buildPrivateRequest({ report: validatePrivateReport(typed()).value, idempotencyKey: randomUUID(), challengeToken: "challenge-token-0123456789" }).value;
  const seen = [];
  const ok = makeHttpPerformer({ ...timers, fetchFn: async (url, init) => { seen.push([url, init]); return { status: 201, json: async () => ({ a: 1 }) }; } });
  assert.deepEqual(await ok(request), { kind: "Success", status: 201, body: { a: 1 } });
  assert.equal(seen[0][1].credentials, "omit");
  assert.equal(seen[0][1].redirect, "error");
  assert.equal(seen[0][1].referrerPolicy, "no-referrer");
  const throwing = online => makeHttpPerformer({ ...timers, isOnline: () => online, fetchFn: async () => { throw new TypeError("x"); } });
  assert.deepEqual(await throwing(true)(request), { kind: "OutcomeUnknown", reason: "connection-lost" });
  assert.deepEqual(await throwing(false)(request), { kind: "Failure", reason: "network" });
  let fire;
  const timeout = makeHttpPerformer({ setTimer: fn => { fire = fn; return 1; }, clearTimer: () => {}, fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  const pending = timeout(request);
  fire();
  assert.deepEqual(await pending, { kind: "OutcomeUnknown", reason: "timeout-after-dispatch" });
  const notJson = makeHttpPerformer({ ...timers, fetchFn: async () => ({ status: 502, json: async () => { throw new SyntaxError("x"); } }) });
  assert.equal(classifyOutcome(await notJson(request)).error.code, "service_unavailable");
});
