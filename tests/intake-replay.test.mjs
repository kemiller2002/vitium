// Fix round 1: idempotent replay vs single-use challenge (VF-010), NFC canonical hash
// (VF-008, hash part), credential coverage of the adversarial sample set (VF-009),
// receipt shape (adversarial #37), shared limits and error codes.
// VIT-API-004/005, VIT-AC-006/008/009.
import test from "node:test";
import assert from "node:assert/strict";
import {makeIntake} from "../service/intake.mjs";
import {createHttpHandler} from "../service/http.mjs";
import {INTAKE_LIMITS} from "../service/limits.mjs";
import {ERROR_CODES} from "../service/errors.mjs";

const origin = "https://vitium.echelonfoundry.com";
const j = (...parts) => parts.join("");
const valid = (patch = {}) => ({
  schemaVersion:"1.0", product:"Forma", impact:"Cannot use the feature",
  title:"Cannot save a change", actual:"Save does nothing.",
  expected:"Changes should be saved.", steps:"Open form.", pageUrl:"https://example.com/path",
  privacyAcknowledged:true, ...patch
});
const ok = value => ({ok:true, value});

/** Store implementing the full port: putOnce + read-only lookup. Records an effect journal. */
function portStore() {
  const records = new Map();
  const journal = [];
  const view = r => ({reference:r.reference, payloadHash:r.payloadHash, receivedAt:r.receivedAt, disposition:r.disposition});
  return {records, journal,
    async lookup(pk) { journal.push("lookup"); const r = records.get(pk); return ok(r ? {found:true, existing:view(r)} : {found:false}); },
    async putOnce(item) {
      journal.push("put");
      const r = records.get(item.pk);
      if (r) return ok({created:false, existing:view(r)});
      records.set(item.pk, item);
      return ok({created:true});
    }};
}
function singleUse(journal) {
  const used = new Set();
  return async token => { journal.push("challenge"); if (used.has(token)) return ok(false); used.add(token); return ok(true); };
}
function fixture() {
  const store = portStore();
  let n = 0;
  const intake = makeIntake({store, verifyChallenge:singleUse(store.journal),
    now:() => "2026-10-08T12:00:0" + (n) + ".000Z", reference:() => "VIT-" + String(++n).padStart(32, "0")});
  return {store, intake, handle:createHttpHandler(intake)};
}
const KEY = "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const event = (body, {key = KEY, token = "challenge-token-0001"} = {}) => ({
  rawPath:"/api/v1/reports", requestContext:{http:{method:"POST"}, requestId:"r-1"},
  headers:{origin, "content-type":"application/json", "idempotency-key":key},
  body:JSON.stringify({...body, challengeToken:token})
});
const parse = r => ({status:r.statusCode, body:JSON.parse(r.body)});

test("R-01 VF-010: lost-response retry (same key, same body, SAME spent token) returns the original receipt", async () => {
  const {store, handle} = fixture();
  const first = parse(await handle(event(valid())));
  assert.equal(first.status, 201);
  const retry = parse(await handle(event(valid())));
  assert.equal(retry.status, 200, "got " + retry.status + " " + retry.body.code);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.reference, first.body.reference);
  assert.equal(retry.body.receivedAt, first.body.receivedAt);
  assert.equal(store.records.size, 1);
  assert.equal(store.journal.filter(x => x === "challenge").length, 1, "replay must not consume a challenge");
});

test("R-02 VF-010/VF-023: same key + different body: spent token -> same 403 as an unused key; verified token -> 409 disclosing nothing", async () => {
  const {store, handle} = fixture();
  const first = parse(await handle(event(valid({actual:"Original private text QWERTY."}))));
  const spent = parse(await handle(event(valid({actual:"Guess"}), {token:"challenge-token-0001"})));
  assert.equal(spent.status, 403);
  assert.equal(spent.body.code, "challenge_failed");
  for (const token of ["challenge-token-fresh-0002"]) {
    const reply = await handle(event(valid({actual:"Guess"}), {token}));
    const r = parse(reply);
    assert.equal(r.status, 409);
    assert.deepEqual(Object.keys(r.body).sort(), ["category", "code", "message", "retryable"]);
    for (const leak of [first.body.reference, first.body.receivedAt, "QWERTY"]) assert.ok(!reply.body.includes(leak), leak);
  }
  assert.equal(store.records.size, 1);
});

test("R-03 VF-010: an unknown key still needs a valid challenge BEFORE any write (reused or invalid token refused)", async () => {
  const {store, handle} = fixture();
  await handle(event(valid()));
  const otherKey = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
  const reused = parse(await handle(event(valid({title:"New report"}), {key:otherKey})));
  assert.equal(reused.status, 403);
  assert.equal(reused.body.code, "challenge_failed");
  assert.equal(store.records.size, 1);
  const journalAfter = store.journal.slice(-2);
  assert.deepEqual(journalAfter, ["lookup", "challenge"], "no put after a failed challenge");
  const fresh = parse(await handle(event(valid({title:"New report"}), {key:otherKey, token:"challenge-token-new-03"})));
  assert.equal(fresh.status, 201);
  assert.deepEqual(store.journal.slice(-3), ["lookup", "challenge", "put"]);
});

test("R-04 VF-008: NFC and NFD spellings of the same report are one canonical payload", async () => {
  const {store, handle} = fixture();
  const nfc = "Café crash";
  const nfd = "Café crash";
  assert.notEqual(nfc, nfd);
  const first = parse(await handle(event(valid({title:nfc}))));
  const second = parse(await handle(event(valid({title:nfd}), {token:"challenge-token-nfd-0004"})));
  assert.equal(second.status, 200, "NFD replay got " + second.status + " " + second.body.code);
  assert.equal(second.body.reference, first.body.reference);
  assert.equal(store.records.size, 1);
  assert.equal([...store.records.values()][0].report.title, nfc, "stored text is NFC");
});

test("R-05 #37: receipt is exactly {schemaVersion, reference, receivedAt, status, replayed}; no detector oracle", async () => {
  const {handle} = fixture();
  const quarantined = parse(await handle(event(valid({actual:"I found an XSS vulnerability"}))));
  assert.equal(quarantined.status, 201);
  assert.deepEqual(Object.keys(quarantined.body).sort(), ["receivedAt", "reference", "replayed", "schemaVersion", "status"]);
  const replay = parse(await handle(event(valid({actual:"I found an XSS vulnerability"}))));
  assert.deepEqual(Object.keys(replay.body).sort(), ["receivedAt", "reference", "replayed", "schemaVersion", "status"]);
});

test("R-06 VF-009: every adversarial credential format is redacted and quarantined by the service", async () => {
  const samples = {
    "fine-grained GitHub PAT": j("github", "_pat_", "11ABCDEFG0123456789_", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"),
    "AWS access key id": j("AK", "IA", "IOSFODNN7", "EXAMPLE"),
    "Slack bot token": j("xo", "xb-", "123456789012-1234567890123-", "abcdefghijklmnopqrstuvwx"),
    "JWT": j("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
    "Bearer header": j("Authorization: Bea", "rer ", "abcdefghijklmnopqrstuvwxyz012345"),
    "token= assignment": j("tok", "en=", "abcdefghijklmnop1234")
  };
  for (const [name, secret] of Object.entries(samples)) {
    const store = portStore();
    const handle = createHttpHandler(makeIntake({store, verifyChallenge:async () => ok(true)}));
    const r = parse(await handle(event(valid({actual:"Here: " + secret}), {key:crypto.randomUUID()})));
    assert.equal(r.status, 201, name);
    const stored = JSON.stringify([...store.records.values()][0]);
    const core = secret.replace(/^Authorization: Bearer /, "").replace(/^token=/, "");
    assert.ok(!stored.includes(core), name + " stored verbatim");
    assert.equal([...store.records.values()][0].state, "quarantined", name);
  }
  for (const [name, pageUrl, secret] of [
    ["token in URL path", j("https://example.com/reset/", "gh", "p_", "abcdefghijklmnopqrstuvwxyz0123"), j("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123")],
    [";jsessionid path parameter", "http://example.com/x;jsessionid=SECRET1234ABCD", "SECRET1234ABCD"]
  ]) {
    const store = portStore();
    const handle = createHttpHandler(makeIntake({store, verifyChallenge:async () => ok(true)}));
    const r = parse(await handle(event(valid({pageUrl}), {key:crypto.randomUUID()})));
    assert.equal(r.status, 201, name);
    const record = [...store.records.values()][0];
    assert.ok(!record.report.pageUrl.includes(secret), name + " kept: " + record.report.pageUrl);
    assert.equal(record.state, "quarantined", name);
  }
});

test("R-07 limits and error codes are single-sourced and fit the largest valid request", async () => {
  assert.ok(Object.isFrozen(INTAKE_LIMITS));
  assert.equal(INTAKE_LIMITS.maxBodyBytes, 24576);
  assert.equal(INTAKE_LIMITS.schemaVersion, "1.0");
  assert.equal(INTAKE_LIMITS.idempotencyKey, "uuid-v4");
  assert.ok(Object.isFrozen(ERROR_CODES));
  const largest = JSON.stringify({...valid({title:"✔".repeat(120), actual:"✔".repeat(1200),
    expected:"✔".repeat(1200), steps:"✔".repeat(900), pageUrl:"https://example.com/" + "p".repeat(1980)}),
    challengeToken:"t".repeat(INTAKE_LIMITS.maxChallengeTokenChars)});
  assert.ok(Buffer.byteLength(largest) <= INTAKE_LIMITS.maxBodyBytes, "largest valid request " + Buffer.byteLength(largest));
  // Every code the HTTP adapter can put on the wire is listed.
  const {handle} = fixture();
  const seen = new Set();
  const probe = async ev => { const b = JSON.parse((await handle(ev)).body); if (b.code) seen.add(b.code); };
  await probe({...event(valid()), headers:{origin:"https://x.example"}});
  await probe({...event(valid()), rawPath:"/x"});
  await probe({...event(valid()), headers:{origin, "content-type":"text/plain", "idempotency-key":KEY}});
  await probe({...event(valid()), body:"{"});
  await probe({...event(valid()), body:"x".repeat(INTAKE_LIMITS.maxBodyBytes + 1)});
  await probe(event(valid(), {key:"nope"}));
  await probe(event(valid(), {token:"short"}));
  await probe(event(valid({actual:""})));
  for (const code of seen) assert.ok(ERROR_CODES.includes(code), code);
  const atLimit = await handle({...event(valid()), body:"{" + " ".repeat(INTAKE_LIMITS.maxBodyBytes - 2) + "}"});
  assert.notEqual(atLimit.statusCode, 413, "exactly at the limit is accepted for parsing");
});
