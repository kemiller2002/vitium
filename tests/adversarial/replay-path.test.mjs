// Adversarial review of the read-before-challenge replay path (fix round 2).
// SEC-001 point 4 / FIX-ROUND-1 contract: a retry with the same key and canonical body
// returns the original receipt without a fresh challenge; an unknown key still needs a
// challenge before any write. VIT-API-003/004, VIT-AC-005/006/009.
import test from "node:test";
import assert from "node:assert/strict";
import { makeIntake } from "../../service/intake.mjs";
import { createHttpHandler } from "../../service/http.mjs";
import { validRequest, memoryStore, httpEvent, ORIGIN, IDEMPOTENCY_KEY, CHALLENGE } from "../verification/contracts.mjs";

const OTHER = "9b2e4567-e89b-42d3-a456-426614174999";
function harness() {
  const store = memoryStore();
  let verifies = 0;
  const spent = new Set();
  const verifyChallenge = async token => { verifies += 1; if (spent.has(token)) return false; spent.add(token); return true; };
  const handle = createHttpHandler(makeIntake({ store, verifyChallenge, now: () => "2026-10-08T12:00:00.000Z" }));
  return { store, handle, verifies: () => verifies };
}
const send = (h, body, key, token) => h.handle(httpEvent(JSON.stringify(token === undefined ? body : { ...body, challengeToken: token }),
  { headers: { origin: ORIGIN, "content-type": "application/json", "idempotency-key": key } }));
const parse = r => ({ status: r.statusCode, body: JSON.parse(r.body), raw: r.body });

test("VIT-API-003 / VIT-AC-005: replay never bypasses the challenge for a NEW record (no token, spent token, known body under a fresh key)", async () => {
  const h = harness();
  assert.equal(parse(await send(h, validRequest(), IDEMPOTENCY_KEY, CHALLENGE)).status, 201);
  const attempts = [
    [validRequest({ title: "new" }), OTHER, undefined],
    [validRequest({ title: "new" }), OTHER, CHALLENGE],
    [validRequest(), OTHER, undefined],           // identical body, fresh key: a NEW request
    [validRequest(), OTHER, CHALLENGE]
  ];
  for (const [body, key, token] of attempts) {
    const r = parse(await send(h, body, key, token));
    assert.equal(r.status, 403, `key=${key.slice(0, 4)} token=${token ? "spent" : "none"}`);
    assert.equal(h.store.records.size, 1, "no new record without a valid challenge");
  }
});

test("VIT-AC-009: a replay or conflict never echoes stored report content", async () => {
  const h = harness();
  await send(h, validRequest({ actual: "UNIQUE-STORED-TEXT-42" }), IDEMPOTENCY_KEY, CHALLENGE);
  const replay = parse(await send(h, validRequest({ actual: "UNIQUE-STORED-TEXT-42" }), IDEMPOTENCY_KEY));
  // Fix round 3 (VF-023 contract): an UNCHALLENGED conflict must look exactly like an unused
  // key, so it is a 403 here; the 409 is only reachable with a fresh valid challenge.
  const unchallengedConflict = parse(await send(h, validRequest({ actual: "other" }), IDEMPOTENCY_KEY));
  const unusedKey = parse(await send(h, validRequest({ actual: "other" }), OTHER));
  assert.equal(unchallengedConflict.status, unusedKey.status, "unchallenged conflict distinguishable by status");
  assert.equal(unchallengedConflict.raw, unusedKey.raw, "unchallenged conflict distinguishable by body");
  const conflict = parse(await send(h, validRequest({ actual: "other" }), IDEMPOTENCY_KEY, CHALLENGE + "-fresh"));
  assert.equal(replay.status, 200);
  assert.equal(conflict.status, 409);
  for (const r of [replay, unchallengedConflict, unusedKey, conflict]) assert.ok(!r.raw.includes("UNIQUE-STORED-TEXT-42"));
  assert.deepEqual(Object.keys(replay.body).sort(), ["receivedAt", "reference", "replayed", "schemaVersion", "status"]);
  assert.deepEqual(Object.keys(conflict.body).sort(), ["category", "code", "message", "retryable"]);
});

test("VIT-API-004: replay is read-only and does not spend a challenge", async () => {
  const h = harness();
  await send(h, validRequest(), IDEMPOTENCY_KEY, CHALLENGE);
  const before = h.verifies();
  for (let i = 0; i < 5; i += 1) assert.equal(parse(await send(h, validRequest(), IDEMPOTENCY_KEY)).status, 200);
  assert.equal(h.verifies(), before, "replay must not call the challenge provider");
  assert.equal(h.store.records.size, 1);
});

// Finding VF-023: without the body or a challenge, the three replay-path outcomes are
// distinguishable, so an attacker who obtains an idempotency key (a client-generated UUID,
// e.g. from a shared device or logs) learns whether that key was used. Required: an
// unknown key and a known key with a different body must be indistinguishable to a
// caller that has not passed a challenge.
test("VIT-AC-009 / VIT-API-010: an unchallenged caller cannot tell an unused key from a used key with a different body", async () => {
  const h = harness();
  await send(h, validRequest(), IDEMPOTENCY_KEY, CHALLENGE);
  const unknown = parse(await send(h, validRequest({ title: "probe" }), OTHER));
  const known = parse(await send(h, validRequest({ title: "probe" }), IDEMPOTENCY_KEY));
  assert.equal(known.status, unknown.status, `status oracle: unknown=${unknown.status} known=${known.status}`);
  assert.equal(known.body.code, unknown.body.code);
  assert.equal(known.raw.length, unknown.raw.length, "size oracle");
});
