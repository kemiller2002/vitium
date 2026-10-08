// Adversarial attacks on service/intake.mjs + service/http.mjs (baseline JS candidate).
// VIT-API-002/003/004/005, VIT-AC-004/005/006/007/008/009.
import test from "node:test";
import assert from "node:assert/strict";
import { makeIntake } from "../../service/intake.mjs";
import { createHttpHandler } from "../../service/http.mjs";
import { normalizeReport } from "../../service/report-domain.mjs";
import { attempt, validRequest, memoryStore, singleUseVerifier, httpEvent, IDEMPOTENCY_KEY, ORIGIN, CHALLENGE } from "../verification/contracts.mjs";

const runtime = attempt(normalizeReport);
const OTHER_KEY = "9b2e4567-e89b-42d3-a456-426614174999";

function harness({ verifyChallenge = async () => true, store = memoryStore(), reference } = {}) {
  let n = 0;
  const intake = makeIntake({
    store, verifyChallenge, now: () => "2026-10-08T12:00:00.000Z",
    reference: reference ?? (() => "VIT-" + String(++n).padStart(32, "0"))
  });
  return { store, intake, handle: createHttpHandler(intake) };
}
const parse = reply => ({ status: reply.statusCode, body: JSON.parse(reply.body) });

// ---------- boundaries (limit-1, limit, limit+1) ----------
for (const [field, limit] of [["title", 120], ["actual", 1200], ["expected", 1200], ["steps", 900], ["pageUrl", 2000]]) {
  test(`VIT-API-002 / VIT-AC-004: ${field} boundary ${limit - 1}/${limit}/${limit + 1}`, () => {
    const make = n => field === "pageUrl" ? "https://example.com/" + "p".repeat(n - 20) : "a".repeat(n);
    assert.equal(runtime(validRequest({ [field]: make(limit - 1) })).ok, true, "limit-1");
    assert.equal(runtime(validRequest({ [field]: make(limit) })).ok, true, "limit");
    const over = runtime(validRequest({ [field]: make(limit + 1) }));
    assert.equal(over.ok, false, "limit+1");
    assert.equal(over.error.status, 400);
  });
}

test("VIT-API-002: HTTP body size boundary at 16384 bytes is exact and counts UTF-8 bytes", async () => {
  const { handle } = harness();
  const pad = n => { const s = JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE, steps: "" }); return s.slice(0, -1) + ',"zz":"' + "x".repeat(n - s.length - 8) + '"}'; };
  const at = pad(16384);
  assert.equal(Buffer.byteLength(at), 16384);
  assert.notEqual(parse(await handle(httpEvent(at))).status, 413, "exactly at the limit is not 413");
  assert.equal(parse(await handle(httpEvent(pad(16385)))).status, 413);
  const multi = JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE }).slice(0, -1) + ',"zz":"' + "é".repeat(8200) + '"}';
  assert.ok(multi.length < 16384 && Buffer.byteLength(multi) > 16384);
  assert.equal(parse(await handle(httpEvent(multi))).status, 413, "byte-length, not char-length");
});

test("VIT-API-002: base64 body is decoded before the size check (no 4/3 bypass)", async () => {
  const { handle } = harness();
  const big = Buffer.from(JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE, zz: "x".repeat(17000) })).toString("base64");
  assert.equal(parse(await handle(httpEvent(big, { isBase64Encoded: true }))).status, 413);
});

// ---------- unexpected properties / prototype tricks ----------
test("VIT-API-002 / VIT-AC-004: unexpected and prototype-polluting properties are refused and nothing is stored", async () => {
  for (const raw of [
    JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE, kind: "defect" }),
    JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE, visibility: "public" }),
    JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE }).replace("{", '{"__proto__":{"visibility":"public"},'),
    JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE }).replace("{", '{"constructor":{"prototype":{"x":1}},')
  ]) {
    const { store, handle } = harness();
    const r = parse(await handle(httpEvent(raw)));
    assert.equal(r.status, 400, raw.slice(0, 60));
    assert.equal(r.body.code, "invalid_input");
    assert.equal(store.records.size, 0);
  }
  assert.equal({}.visibility, undefined, "Object.prototype not polluted");
});

test("VIT-API-002: duplicate JSON keys resolve deterministically and still pass validation", async () => {
  const { store, handle } = harness();
  const raw = JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE }).replace('"product":"Forma"', '"product":"Forma","product":"Nonexistent"');
  assert.equal(parse(await handle(httpEvent(raw))).status, 400);
  assert.equal(store.records.size, 0);
});

// ---------- unicode / RTL / zero-width ----------
const INVISIBLE = Object.freeze({
  "zero-width space only": "​​",
  "RTL override filename spoof": "invoice‮gnp.exe",
  "LRI/PDI isolate": "⁦abc⁩",
  "C1 CSI control": "\u009b31mred",
  "lone surrogate": "a\ud800b",
  "zero-width joiner only": "‍",
  "word joiner only": "⁠"
});

test("VIT-API-002 / VIT-AC-004: visually empty or bidi-spoofing summaries are refused or neutralised", () => {
  for (const [name, title] of Object.entries(INVISIBLE)) {
    const r = runtime(validRequest({ title }));
    const neutralised = r.ok && !/[​-‏‪-‮⁠-⁩\u0080-\u009f\ud800-\udfff]/.test(r.value.title);
    assert.ok(!r.ok || neutralised, name + " accepted verbatim");
  }
});

test("VIT-API-002: BOM/whitespace-only summary is refused (control for the unicode test)", () => {
  for (const title of ["﻿", " ", " \t\n "]) assert.equal(runtime(validRequest({ title })).ok, false, JSON.stringify(title));
});

test("VIT-AC-004: payload hash is stable across Unicode normalisation forms (NFC vs NFD replay)", { todo: "finding VF-008" }, async () => {
  const { store, intake } = harness();
  await intake.submit(validRequest({ title: "Café crash" }), { idempotencyKey: IDEMPOTENCY_KEY, challengeToken: CHALLENGE });
  const replay = await attempt(() => intake.submit(validRequest({ title: "Café crash" }), { idempotencyKey: IDEMPOTENCY_KEY, challengeToken: CHALLENGE + "x" }))().value;
  const result = await replay.catch(e => ({ code: e.code }));
  assert.equal(result.code, undefined, "canonically equivalent text treated as a different report: " + result.code);
  assert.equal(store.records.size, 1);
});

// ---------- credential guardrail ----------
test("VIT-AC-008 / VIT-NFR-004: common credential formats are refused (not only ghp_/sk-/password=)", { todo: "finding VF-009" }, () => {
  const samples = {
    "fine-grained GitHub PAT": "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
    "AWS access key id": "AKIAIOSFODNN7EXAMPLE",
    "Slack bot token": "xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx",
    "JWT": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "Bearer header": "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
    "token= assignment": "token=abcdefghijklmnop1234",
    "secret in URL path": null
  };
  for (const [name, value] of Object.entries(samples)) {
    if (value === null) continue;
    assert.equal(runtime(validRequest({ actual: "Here: " + value })).ok, false, name + " accepted");
  }
  const pathToken = runtime(validRequest({ pageUrl: "https://example.com/reset/ghp_abcdefghijklmnopqrstuvwxyz0123" }));
  assert.ok(!pathToken.ok || !pathToken.value.pageUrl.includes("ghp_"), "token kept in sanitised URL path");
});

test("VIT-AC-008: credential guard refuses obvious tokens in every free-text field (control)", () => {
  for (const field of ["title", "actual", "expected", "steps"]) {
    const r = runtime(validRequest({ [field]: "ghp_abcdefghijklmnopqrstuvwxyz0123" }));
    assert.equal(r.ok, false, field);
    assert.doesNotMatch(r.error.message, /ghp_/, "error message must not echo the secret");
  }
});

test("VIT-API-002: URL sanitisation strips userinfo, query and fragment for every accepted scheme form", () => {
  for (const [input, expected] of [
    ["https://u:p@example.com/a?b=c#d", "https://example.com/a"],
    ["HTTPS://EXAMPLE.com:443/A", "https://example.com/A"],
    ["http://example.com:8080/x;jsessionid=SECRET", "http://example.com:8080/x;jsessionid=SECRET"],
    ["https://example.com/%3Fq=1", "https://example.com/%3Fq=1"]
  ]) {
    const r = runtime(validRequest({ pageUrl: input }));
    assert.ok(r.ok, input);
    assert.equal(r.value.pageUrl, expected, input);
    assert.ok(!/u:p|b=c|#d/.test(r.value.pageUrl));
  }
});

test("VIT-AC-008: path-parameter session ids (;jsessionid=) are stripped from page URLs", { todo: "finding VF-009" }, () => {
  const r = runtime(validRequest({ pageUrl: "http://example.com/x;jsessionid=SECRET" }));
  assert.ok(r.ok);
  assert.doesNotMatch(r.value.pageUrl, /SECRET/);
});

// ---------- idempotency ----------
test("VIT-API-004 / VIT-AC-006: replay with altered body under the same key is a 409 and the original is untouched", async () => {
  const { store, handle } = harness();
  const first = parse(await handle(httpEvent(validRequest())));
  assert.equal(first.status, 201);
  for (const patch of [{ title: "Different" }, { product: "Ordo" }, { pageUrl: "https://example.com/other" }, { steps: "" }]) {
    const r = parse(await handle(httpEvent(validRequest(patch))));
    assert.equal(r.status, 409, JSON.stringify(patch));
    assert.equal(r.body.code, "request_conflict");
    assert.equal(r.body.reference, undefined, "conflict must not disclose the original reference");
  }
  assert.equal(store.records.size, 1);
  assert.equal([...store.records.values()][0].report.title, "Cannot save a change");
});

test("VIT-API-004: replay differing only by sanitised-away URL parts is treated as the same report", async () => {
  const { store, handle } = harness();
  await handle(httpEvent(validRequest({ pageUrl: "https://example.com/path?a=1" })));
  const r = parse(await handle(httpEvent(validRequest({ pageUrl: "https://example.com/path#zzz" }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.replayed, true);
  assert.equal(store.records.size, 1);
});

test("VIT-API-004: idempotency key is case-insensitive (same UUID upper/lower case is one request)", async () => {
  const { store, handle } = harness();
  await handle(httpEvent(validRequest()));
  const r = parse(await handle(httpEvent(validRequest(), { headers: { origin: ORIGIN, "content-type": "application/json", "idempotency-key": IDEMPOTENCY_KEY.toUpperCase() } })));
  assert.equal(r.status, 200);
  assert.equal(store.records.size, 1);
});

test("VIT-AC-006 / VIT-AC-009: replay response does not reveal the original receivedAt to a different challenger beyond the reference", async () => {
  const { handle } = harness();
  const a = parse(await handle(httpEvent(validRequest())));
  const b = parse(await handle(httpEvent(validRequest())));
  assert.deepEqual(Object.keys(b.body).sort(), ["receivedAt", "reference", "replayed", "schemaVersion", "status"]);
  assert.equal(b.body.reference, a.body.reference);
});

test("VIT-AC-007 / VIT-API-005: inconsistent store reply (created:false, no existing) is a retryable 503, not a 409 conflict", { todo: "finding VF-013" }, async () => {
  const { handle } = harness({ store: { async putOnce() { return { created: false }; } } });
  const r = parse(await handle(httpEvent(validRequest())));
  assert.notEqual(r.body.status, "received");
  assert.equal(r.status, 503, "got " + r.status + " " + r.body.code);
});

test("VIT-AC-007: a store that resolves 'created' but returns a malformed reply is never acknowledged", async () => {
  for (const reply of [undefined, null, {}, { created: "yes" }, { created: false, existing: { payloadHash: "x" } }]) {
    const { handle } = harness({ store: { async putOnce() { return reply; } } });
    const r = parse(await handle(httpEvent(validRequest())));
    assert.ok(r.status >= 400, JSON.stringify(reply));
    assert.notEqual(r.body.status, "received");
  }
});

// ---------- challenge ----------
test("VIT-API-003 / VIT-AC-005: challenge is verified before any store effect", async () => {
  let order = [];
  const store = { async putOnce() { order = [...order, "store"]; return { created: true }; } };
  const { handle } = harness({ store, verifyChallenge: async () => { order = [...order, "verify"]; return true; } });
  await handle(httpEvent(validRequest()));
  assert.deepEqual(order, ["verify", "store"]);
});

test("VIT-API-003: a verifier returning a truthy non-boolean is not treated as success", async () => {
  for (const value of ["true", 1, {}, { success: true }]) {
    const store = memoryStore();
    const { handle } = harness({ store, verifyChallenge: async () => value });
    assert.equal(parse(await handle(httpEvent(validRequest()))).status, 403, JSON.stringify(value));
    assert.equal(store.records.size, 0);
  }
});

test("VIT-API-003 / VIT-AC-006: reusing a spent challenge token for a NEW report is refused", async () => {
  const { store, handle } = harness({ verifyChallenge: singleUseVerifier() });
  assert.equal(parse(await handle(httpEvent(validRequest()))).status, 201);
  const second = parse(await handle(httpEvent(validRequest({ title: "Another report" }), {
    headers: { origin: ORIGIN, "content-type": "application/json", "idempotency-key": OTHER_KEY }
  })));
  assert.equal(second.status, 403);
  assert.equal(store.records.size, 1);
});

test("VIT-API-004 / VIT-AC-006 (control): retry with the same key and body but a FRESH token returns the original receipt", async () => {
  // This is the path site/app.mjs takes: requestId survives a failure, resetChallenge() forces a new token.
  const { store, handle } = harness({ verifyChallenge: singleUseVerifier() });
  const first = parse(await handle(httpEvent(validRequest())));
  const retry = parse(await handle(httpEvent(JSON.stringify({ ...validRequest(), challengeToken: CHALLENGE + "-fresh" }))));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.reference, first.body.reference);
  assert.equal(store.records.size, 1);
});

test("VIT-API-004 / VIT-AC-006: an identical retry after a lost response succeeds even though the challenge token is single-use", { todo: "finding VF-010" }, async () => {
  // Client sends, server stores, response is lost; browser retries the SAME request
  // (same Idempotency-Key, same body, same token because the UI had no reply).
  const { store, handle } = harness({ verifyChallenge: singleUseVerifier() });
  const first = parse(await handle(httpEvent(validRequest())));
  assert.equal(first.status, 201);
  const retry = parse(await handle(httpEvent(validRequest())));
  assert.equal(retry.status, 200, "retry got " + retry.status + " " + retry.body.code + " — the stored receipt is unreachable");
  assert.equal(retry.body.reference, first.body.reference);
  assert.equal(store.records.size, 1);
});

test("VIT-AC-004 / VIT-AC-015: challenge token, secret-bearing errors and report text never appear in any response", async () => {
  const leaky = { async putOnce() { throw new Error("ddb password=hunter2 arn:aws:dynamodb:us-east-1:123456789012:table/x"); } };
  const { handle } = harness({ store: leaky });
  const reply = await handle(httpEvent(validRequest()));
  for (const forbidden of [CHALLENGE, "hunter2", "arn:aws", "123456789012", "Save does nothing"]) {
    assert.ok(!reply.body.includes(forbidden), forbidden);
    assert.ok(!JSON.stringify(reply.headers).includes(forbidden), forbidden);
  }
});

// ---------- HTTP surface ----------
test("VIT-AC-009: path and method variants never reach the intake or disclose records", async () => {
  const { store, handle } = harness();
  for (const [method, path] of [["GET", "/api/v1/reports"], ["PUT", "/api/v1/reports"], ["POST", "/api/v1/reports/"], ["POST", "/API/V1/REPORTS"], ["POST", "/api/v1/reports/VIT-1"], ["GET", "/api/v1/reports/VIT-00000000000000000000000000000001"], ["POST", "/api/v1/../v1/reports"]]) {
    const r = parse(await handle(httpEvent(validRequest(), { rawPath: path, requestContext: { http: { method } } })));
    assert.equal(r.status, 404, method + " " + path);
  }
  assert.equal(store.records.size, 0);
});

test("VIT-API-001: origin comparison is exact (no suffix/prefix/case/null tricks)", async () => {
  const { handle } = harness();
  for (const origin of ["https://vitium.echelonfoundry.com.evil.example", "https://evil.vitium.echelonfoundry.com", "http://vitium.echelonfoundry.com", "HTTPS://VITIUM.ECHELONFOUNDRY.COM", "null", "https://vitium.echelonfoundry.com/", undefined]) {
    const headers = { "content-type": "application/json", "idempotency-key": IDEMPOTENCY_KEY, ...(origin === undefined ? {} : { origin }) };
    const reply = await handle(httpEvent(validRequest(), { headers }));
    assert.equal(reply.statusCode, 403, String(origin));
    assert.equal(reply.headers["access-control-allow-origin"], undefined);
  }
});

test("VIT-API-002: content-type variants outside application/json[;charset=utf-8] are refused", async () => {
  const { handle } = harness();
  for (const ct of ["application/json; charset=utf-16", "application/json-patch+json", "text/json", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
    const reply = await handle(httpEvent(validRequest(), { headers: { origin: ORIGIN, "content-type": ct, "idempotency-key": IDEMPOTENCY_KEY } }));
    assert.equal(reply.statusCode, 415, ct);
  }
});

test("VIT-API-002: JSON non-object bodies are a typed 400", async () => {
  const { handle } = harness();
  for (const body of ["null", "[]", "\"x\"", "1", "true"]) {
    const r = parse(await handle(httpEvent(body)));
    assert.equal(r.status, 400, body);
    assert.ok(["invalid_input", "invalid_json"].includes(r.body.code));
  }
});
