// Fix round 2: key-use oracle (VF-023), unchallenged storage reads (VF-024) and the public
// route refusing machine-observation envelopes (VITIUM-BUILD-SYSTEM-REPORTING.md).
// VIT-API-003/004, VIT-AC-005/006/009, VIT-INT-013.
import test from "node:test";
import assert from "node:assert/strict";
import {makeIntake} from "../service/intake.mjs";
import {createHttpHandler} from "../service/http.mjs";

const origin = "https://vitium.echelonfoundry.com";
const USED = "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const UNUSED = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const valid = (patch = {}) => ({
  schemaVersion:"1.0", product:"Forma", impact:"Cannot use the feature",
  title:"Cannot save a change", actual:"Save does nothing.",
  expected:"Changes should be saved.", steps:"Open form.", pageUrl:"https://example.com/path",
  privacyAcknowledged:true, ...patch
});
const ok = value => ({ok:true, value});

function fixture() {
  const records = new Map();
  const journal = [];
  const spent = new Set();
  const view = r => ({reference:r.reference, payloadHash:r.payloadHash, receivedAt:r.receivedAt});
  const store = {
    async lookup(pk) { journal.push("lookup"); const r = records.get(pk); return ok(r ? {found:true, existing:view(r)} : {found:false}); },
    async putOnce(item) { journal.push("put"); const r = records.get(item.pk); if (r) return ok({created:false, existing:view(r)}); records.set(item.pk, item); return ok({created:true}); }
  };
  const verifyChallenge = async token => { journal.push("challenge"); if (spent.has(token)) return ok(false); spent.add(token); return ok(true); };
  const handle = createHttpHandler(makeIntake({store, verifyChallenge}));
  return {records, journal, handle};
}
const event = (body, key, token) => ({
  rawPath:"/api/v1/reports", requestContext:{http:{method:"POST"}, requestId:"r-2"},
  headers:{origin, "content-type":"application/json", "idempotency-key":key},
  body:JSON.stringify(token === undefined ? body : {...body, challengeToken:token})
});
const SEED_TOKEN = "seed-challenge-token-0001";

test("O-01 VF-023: unused key and used-key-with-different-body are indistinguishable without a verified challenge", async () => {
  for (const [label, token] of [["no token", undefined], ["malformed token", "short"], ["spent token", SEED_TOKEN], ["unverifiable token", "never-issued-token-0002"]]) {
    const f = fixture();
    assert.equal((await f.handle(event(valid(), USED, SEED_TOKEN))).statusCode, 201);
    // "unverifiable" must be spent for both probes, so pre-spend it as the provider would refuse it.
    if (label === "unverifiable token") await f.handle(event(valid({title:"burn"}), "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", token));
    const unknown = await f.handle(event(valid({title:"probe"}), UNUSED, token));
    const known = await f.handle(event(valid({title:"probe"}), USED, token));
    assert.equal(known.statusCode, unknown.statusCode, label + ": status oracle " + unknown.statusCode + "/" + known.statusCode);
    assert.equal(known.body, unknown.body, label + ": body oracle");
    assert.equal(known.statusCode, 403, label);
  }
});

test("O-02 VF-023: the 409 conflict is only answered to a caller with a verified fresh challenge", async () => {
  const f = fixture();
  await f.handle(event(valid(), USED, SEED_TOKEN));
  const r = await f.handle(event(valid({title:"other"}), USED, "fresh-challenge-token-0003"));
  assert.equal(r.statusCode, 409);
  assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(), ["category", "code", "message", "retryable"]);
  assert.equal(f.records.size, 1);
});

test("O-03 VF-010 stays closed: identical retry with the original spent token replays without calling the provider", async () => {
  const f = fixture();
  const first = JSON.parse((await f.handle(event(valid(), USED, SEED_TOKEN))).body);
  const before = f.journal.filter(x => x === "challenge").length;
  const retry = await f.handle(event(valid(), USED, SEED_TOKEN));
  assert.equal(retry.statusCode, 200);
  assert.equal(JSON.parse(retry.body).reference, first.reference);
  assert.equal(f.journal.filter(x => x === "challenge").length, before);
});

test("O-04 VF-024: a present but syntactically invalid token costs no storage read and no provider call", async () => {
  for (const token of ["", "short", "x".repeat(4097), "has spaces in the token", 12345678901234, null]) {
    const f = fixture();
    const r = await f.handle(event(valid(), UNUSED, token));
    assert.equal(r.statusCode, 403, String(token));
    assert.equal(JSON.parse(r.body).code, "challenge_required");
    assert.deepEqual(f.journal, [], "effects before pre-filter for " + String(token).slice(0, 12));
  }
  // An ABSENT token must still reach the read-only lookup (tokenless identical replay is the
  // contract, VF-010). Bounded: exactly one read, no provider call, no write.
  const f = fixture();
  const r = await f.handle(event(valid(), UNUSED, undefined));
  assert.equal(r.statusCode, 403);
  assert.equal(JSON.parse(r.body).code, "challenge_required");
  assert.deepEqual(f.journal, ["lookup"]);
});

test("O-05 build-system reporting: machine-observation envelopes are refused by the public route and never stored", async () => {
  const envelope = {
    schemaVersion:"1.0", eventId:"0276f8ac-a673-4d62-85a7-5d2292ef0cdd", eventType:"observation.detected",
    source:{system:"praxis", repository:"kemiller2002/summa", installationId:"x", version:"y"},
    subject:{workItemId:"WI-0042", commit:"f".repeat(40), runId:"run-1", checkId:"verify", environment:"ci"},
    finding:{category:"test-failure", summary:"s", expected:"e", observed:"o", classification:"untriaged", confidence:"observed"},
    evidence:[{kind:"test-result", uri:"https://example.invalid/run/1", sha256:"a".repeat(64)}],
    correlation:{defectId:null, verificationAttemptId:null, causationEventId:null},
    observedAt:"2026-10-08T12:00:00Z"
  };
  const variants = [
    ["pure envelope", envelope],
    ["envelope fields smuggled into a valid report", {...valid(), eventId:envelope.eventId, source:envelope.source, finding:envelope.finding}],
    ["report with machine provenance claim", {...valid(), source:"ci"}]
  ];
  for (const [label, body] of variants) {
    const f = fixture();
    const r = await f.handle(event(body, UNUSED, "valid-looking-token-0004"));
    assert.equal(r.statusCode, 400, label);
    assert.equal(JSON.parse(r.body).code, "invalid_input", label);
    assert.equal(JSON.parse(r.body).category, "validation", label);
    assert.equal(f.records.size, 0, label);
    assert.deepEqual(f.journal, [], label + ": refused before any lookup or challenge");
  }
  const machineRoute = await fixture().handle({...event(envelope, UNUSED, "valid-looking-token-0004"), rawPath:"/api/v1/observations"});
  assert.equal(machineRoute.statusCode, 404, "the public intake handler does not serve the machine route");
});
