// Adversarial differential testing: intake-request.schema.json (via ajv, draft
// 2020-12 + formats) versus the runtime contract service/report-domain.mjs.
// VIT-DOM-003 requires payloads to be "schema-validated": a schema that disagrees
// with the runtime is not the contract anyone is actually enforcing.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReport } from "../../service/report-domain.mjs";
import { makeIntake } from "../../service/intake.mjs";
import { schemaValidator, attempt, validRequest, memoryStore, CHALLENGE, IDEMPOTENCY_KEY } from "../verification/contracts.mjs";

const schema = schemaValidator("schemas/intake-request.schema.json");
const observationSchema = schemaValidator("schemas/observation.schema.json");
const runtime = attempt(normalizeReport);
// The schema describes the wire body (challengeToken included); runtime ignores it.
const wire = patch => ({ ...validRequest(patch), challengeToken: CHALLENGE });

/** Pure: classify how schema and runtime disagree on a payload. */
const verdict = payload => ({ schema: schema(payload).ok, runtime: runtime(payload).ok });

const AGREEMENT_CASES = Object.freeze([
  ["baseline valid", wire(), true],
  ["missing schemaVersion", (({ schemaVersion, ...r }) => r)(wire()), false],
  ["schemaVersion 2.0", wire({ schemaVersion: "2.0" }), false],
  ["unexpected property", wire({ severity: "critical" }), false],
  ["own __proto__ property", JSON.parse(JSON.stringify(wire()).replace("{", '{"__proto__":{"admin":true},')), false],
  ["constructor property", wire({ constructor: "x" }), false],
  ["privacyAcknowledged 'true' string", wire({ privacyAcknowledged: "true" }), false],
  ["product not in list", wire({ product: "Nonexistent" }), false],
  ["title array", wire({ title: ["a"] }), false],
  ["title number", wire({ title: 5 }), false],
  ["title at 120", wire({ title: "a".repeat(120) }), true],
  ["title at 121", wire({ title: "a".repeat(121) }), false],
  ["actual at 1200", wire({ actual: "a".repeat(1200) }), true],
  ["actual at 1201", wire({ actual: "a".repeat(1201) }), false],
  ["steps at 900", wire({ steps: "a".repeat(900) }), true],
  ["steps at 901", wire({ steps: "a".repeat(901) }), false],
  ["https URL", wire({ pageUrl: "https://example.com/a" }), true]
]);

for (const [name, payload, expected] of AGREEMENT_CASES) {
  test("VIT-DOM-003 / VIT-AC-004: schema and runtime agree (" + name + ")", () => {
    assert.deepEqual(verdict(payload), { schema: expected, runtime: expected });
  });
}

// Each case: schema verdict vs runtime verdict currently differ on baseline.
const DIVERGENT_CASES = Object.freeze([
  // schema accepts, runtime refuses
  ["title of 120 astral code points (schema counts code points, runtime UTF-16 units)", wire({ title: "🪲".repeat(120) }), "VF-006"],
  ["actual of 1200 astral code points", wire({ actual: "𝔸".repeat(1200) }), "VF-006"],
  ["whitespace-only title", wire({ title: "   " }), "VF-007"],
  ["NUL in title", wire({ title: "a\u0000b" }), "VF-007"],
  ["javascript: page URL", wire({ pageUrl: "javascript:alert(1)" }), "VF-007"],
  ["data: page URL", wire({ pageUrl: "data:text/html,x" }), "VF-007"],
  ["credential text", wire({ actual: "password: hunter2hunter2" }), "VF-007"],
  // runtime accepts, schema refuses
  ["empty pageUrl (what the browser sends when blank)", wire({ pageUrl: "" }), "VF-007"],
  ["null steps", wire({ steps: null }), "VF-007"],
  ["null pageUrl", wire({ pageUrl: null }), "VF-007"],
  ["title padded to 121 then trimmed", wire({ title: " " + "a".repeat(120) }), "VF-007"]
]);

for (const [name, payload, finding] of DIVERGENT_CASES) {
  test("VIT-DOM-003: schema and runtime agree (" + name + ")", () => {
    const v = verdict(payload);
    assert.equal(v.schema, v.runtime, "schema=" + v.schema + " runtime=" + v.runtime);
  });
}

test("VIT-DOM-003: an observation produced by makeIntake validates against observation.schema.json", async () => {
  const store = memoryStore();
  const intake = makeIntake({ store, verifyChallenge: async () => true, now: () => "2026-10-08T12:00:00.000Z" });
  await intake.submit(validRequest(), { idempotencyKey: IDEMPOTENCY_KEY, challengeToken: CHALLENGE });
  const [item] = [...store.records.values()];
  const result = observationSchema(item);
  assert.ok(result.ok, JSON.stringify(result.error));
  assert.ok(!JSON.stringify(item).includes(CHALLENGE), "challenge token must never be persisted");
});

test("VIT-DOM-003: observation schema refuses a record whose report carries unexpected or token fields", () => {
  const item = {
    pk: "REQUEST#" + "a".repeat(64), reference: "VIT-" + "A".repeat(32), payloadHash: "b".repeat(64),
    report: { schemaVersion: "1.0", product: "Forma", impact: "Not sure", title: "t", actual: "a", expected: "e", steps: "", pageUrl: "", challengeToken: CHALLENGE },
    source: "public-api", visibility: "private", kind: "observation", status: "received", state: "received",
    revision: 0, history: [], receivedAt: "2026-10-08T12:00:00.000Z"
  };
  assert.equal(observationSchema(item).ok, false);
  const clean = (({ challengeToken, ...r }) => r)(item.report);
  assert.equal(observationSchema({ ...item, report: clean }).ok, true, "control: the same record without the token is valid");
  assert.equal(observationSchema({ ...item, report: clean, visibility: "public" }).ok, false);
});
