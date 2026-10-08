import test from "node:test";
import assert from "node:assert/strict";
import { makeMachineIntake, MachineIntakeError } from "../service/machine-intake.mjs";
import { createMachineHttpHandler } from "../service/machine-http.mjs";
import { defineBinding, AuthorizationError } from "../service/machine-auth.mjs";
import { normalizeMachineObservation, groupOccurrences, fingerprint, normalizeSignature } from "../service/machine-observation.mjs";

const now = "2026-10-08T12:00:00.000Z";
const nowSeconds = Date.parse(now) / 1000;
const commitA = "f6a987d3c71ad2f4ced1711528e296a42c51d9f4";
const commitB = "0123456789abcdef0123456789abcdef01234567";
const digest = "f5b265b3274bc9ef0876bc1b0b160bdf1c0c79e26613f18928a7d89df74eead9";
const envelope = (patch = {}) => ({
  schemaVersion: "1.0",
  eventId: "0276f8ac-a673-4d62-85a7-5d2292ef0cdd",
  eventType: "observation.detected",
  source: { system: "praxis", repository: "kemiller2002/summa", installationId: "praxis-ci-1", version: "3.7.2", ...patch.source },
  subject: { workItemId: "WI-0042", commit: commitA, runId: "pipeline-run-123", checkId: "verify-abi", environment: "ci", ...patch.subject },
  finding: {
    category: "test-failure", summary: "Routing contract failed during regression verification",
    expected: "Route matches verified binding", observed: "Binding assertion failed at line 42",
    classification: "untriaged", confidence: "observed", ...patch.finding
  },
  evidence: patch.evidence ?? [{ kind: "test-result", uri: "https://github.com/kemiller2002/summa/actions/runs/123", sha256: digest }],
  correlation: { defectId: null, verificationAttemptId: null, causationEventId: null, ...patch.correlation },
  observedAt: patch.observedAt ?? "2026-10-08T11:59:00Z",
  ...(patch.top || {})
});
const bindings = [
  defineBinding({ subject: "repo:kemiller2002/summa:ref:refs/heads/main", system: "praxis",
    repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["observation.detected", "verification.failed"] }),
  defineBinding({ subject: "repo:kemiller2002/summa:ref:refs/heads/release", system: "praxis",
    repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["observation.detected"] }),
  defineBinding({ subject: "repo:kemiller2002/summa:dokimos", system: "dokimos",
    repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["observation.detected"] }),
  defineBinding({ subject: "repo:kemiller2002/vitium:ref:refs/heads/main", system: "ci",
    repositories: ["kemiller2002/vitium"], environments: ["ci"], eventTypes: ["observation.detected"] })
];
const claimsFor = (sub, patch = {}) => ({ sub, iat: nowSeconds - 60, exp: nowSeconds + 240, jti: "token-" + sub.length, ...patch });
// The verifier stands in for a real OIDC signature check: a token value maps to verified claims.
const tokens = {
  "praxis-token-0000000000": claimsFor("repo:kemiller2002/summa:ref:refs/heads/main"),
  "praxis-token-1111111111": claimsFor("repo:kemiller2002/summa:ref:refs/heads/main", { jti: "second-token" }),
  "release-token-000000000": claimsFor("repo:kemiller2002/summa:ref:refs/heads/release"),
  "dokimos-token-000000000": claimsFor("repo:kemiller2002/summa:dokimos"),
  "vitiumci-token-00000000": claimsFor("repo:kemiller2002/vitium:ref:refs/heads/main"),
  "expired-token-000000000": claimsFor("repo:kemiller2002/summa:ref:refs/heads/main", { iat: nowSeconds - 900, exp: nowSeconds - 1 }),
  "longlived-token-0000000": claimsFor("repo:kemiller2002/summa:ref:refs/heads/main", { exp: nowSeconds + 86_400 }),
  "unbound-token-000000000": claimsFor("repo:someone/else:ref:refs/heads/main")
};
function memoryStore() {
  const records = new Map();
  return {
    records,
    async putOnce(item) {
      if (records.has(item.pk)) return { created: false, existing: records.get(item.pk) };
      records.set(item.pk, item);
      return { created: true };
    }
  };
}
function fixture(overrides = {}) {
  const store = overrides.store || memoryStore();
  const intake = makeMachineIntake({
    store, bindings,
    verifyWorkloadToken: overrides.verify || (async token => tokens[token] ?? null),
    now: () => now
  });
  return { store, intake, handle: createMachineHttpHandler(intake) };
}
const auth = token => ({ authorization: "Bearer " + token });
const rejects = (promise, code, status) => assert.rejects(promise, error =>
  error instanceof MachineIntakeError && error.code === code && error.status === status);

test("VIT-AC-032: an authenticated failure is stored privately as an untriaged observation with provenance", async () => {
  const { store, intake } = fixture();
  const ack = await intake.submit(envelope(), auth("praxis-token-0000000000"));
  assert.equal(ack.status, "received");
  assert.equal(ack.classification, "untriaged");
  assert.equal(ack.replayed, false);
  const [item] = store.records.values();
  assert.equal(item.kind, "machine-observation");
  assert.equal(item.state, "received");
  assert.equal(item.visibility, "private");
  assert.equal(item.provenance, "application");
  assert.equal(item.principal.subject, "repo:kemiller2002/summa:ref:refs/heads/main");
  assert.equal(item.envelope.source.repository, "kemiller2002/summa");
  assert.equal(item.envelope.evidence[0].sha256, digest);
  assert.ok(!("defectId" in item) && item.state !== "confirmed", "machine events are never auto-promoted");
});

test("spec test 1: identical deliveries give one observation and two acknowledgments", async () => {
  const { store, intake } = fixture();
  const first = await intake.submit(envelope(), auth("praxis-token-0000000000"));
  const second = await intake.submit(envelope(), auth("praxis-token-1111111111"));
  assert.equal(store.records.size, 1);
  assert.deepEqual([first.replayed, second.replayed], [false, true]);
  assert.equal(first.eventId, second.eventId);
  assert.equal(first.receivedAt, second.receivedAt, "replay reports the original receipt, not a new one");
});

test("spec test 2: same fingerprint on distinct commits/runs keeps two occurrences of one candidate", async () => {
  const { store, intake } = fixture();
  await intake.submit(envelope(), auth("praxis-token-0000000000"));
  await intake.submit(envelope({
    top: { eventId: "1276f8ac-a673-4d62-85a7-5d2292ef0cdd" },
    subject: { commit: commitB, runId: "pipeline-run-124" },
    finding: { observed: "Binding assertion failed at line 57" }
  }), auth("praxis-token-0000000000"));
  const items = [...store.records.values()];
  assert.equal(items.length, 2);
  assert.equal(items[0].fingerprint, items[1].fingerprint);
  const groups = groupOccurrences(items);
  assert.equal(Object.keys(groups).length, 1);
  assert.deepEqual(Object.values(groups)[0].occurrences.map(x => x.commit), [commitA, commitB]);
  // A different check is not silently merged.
  const other = normalizeMachineObservation(envelope({ subject: { checkId: "verify-routes" } }), now);
  assert.notEqual(fingerprint(other), items[0].fingerprint);
  assert.equal(normalizeSignature("Run 123 failed at deadbeefcafe"), normalizeSignature("Run 9 failed at 0123456789ab"));
});

test("replayed eventId with different content or a different workload identity conflicts", async () => {
  const { store, intake } = fixture();
  await intake.submit(envelope(), auth("praxis-token-0000000000"));
  await rejects(intake.submit(envelope({ finding: { summary: "Rewritten history" } }), auth("praxis-token-0000000000")), "event_conflict", 409);
  const original = [...store.records.values()][0];
  assert.equal(original.envelope.finding.summary, "Routing contract failed during regression verification");
  // Another bound producer replaying the same eventId cannot claim authorship.
  await rejects(intake.submit(envelope({ source: { system: "dokimos" } }), auth("dokimos-token-000000000")), "event_conflict", 409);
  await assert.rejects(intake.submit(envelope(), auth("release-token-000000000")), /different workload identity/);
});

test("spec test 3: forged identity, repository scope, expired or long-lived tokens fail safely", async () => {
  const { store, intake } = fixture();
  await rejects(intake.submit(envelope(), {}), "unauthenticated", 401);
  await rejects(intake.submit(envelope(), { authorization: "Basic abc" }), "unauthenticated", 401);
  await rejects(intake.submit(envelope(), auth("unknown-token-000000000")), "unauthenticated", 401);
  await rejects(intake.submit(envelope(), auth("expired-token-000000000")), "unauthenticated", 401);
  await rejects(intake.submit(envelope(), auth("longlived-token-0000000")), "unauthenticated", 401);
  await rejects(intake.submit(envelope(), auth("unbound-token-000000000")), "scope_denied", 403);
  // Claiming another system in the payload is not proof of being that system.
  await rejects(intake.submit(envelope({ source: { system: "tutela" } }), auth("praxis-token-0000000000")), "scope_denied", 403);
  await rejects(intake.submit(envelope({ source: { repository: "kemiller2002/arca" } }), auth("praxis-token-0000000000")), "scope_denied", 403);
  await rejects(intake.submit(envelope({ subject: { environment: "production" } }), auth("praxis-token-0000000000")), "scope_denied", 403);
  await rejects(intake.submit(envelope({ top: { eventType: "verification.passed" }, correlation: { defectId: "VIT-0042", verificationAttemptId: "a-1" } }),
    auth("praxis-token-0000000000")), "scope_denied", 403);
  assert.equal(store.records.size, 0);
});

test("identity verifier outage is distinguishable from bad credentials", async () => {
  const { intake } = fixture({ verify: async () => { throw new Error("jwks timeout"); } });
  await rejects(intake.submit(envelope(), auth("praxis-token-0000000000")), "identity_unavailable", 503);
  const typed = fixture({ verify: async () => { throw new AuthorizationError("unauthenticated", 401, "bad signature"); } });
  await rejects(typed.intake.submit(envelope(), auth("praxis-token-0000000000")), "unauthenticated", 401);
});

test("malformed, unsafe, stale and self-classified envelopes are refused before storage", async () => {
  const { store, intake } = fixture();
  const token = auth("praxis-token-0000000000");
  const cases = [
    [envelope({ top: { extra: true } }), "invalid_observation"],
    [envelope({ top: { schemaVersion: "2.0" } }), "unsupported_version"],
    [envelope({ finding: { classification: "confirmed" } }), "invalid_observation"],
    [envelope({ subject: { commit: "HEAD" } }), "invalid_observation"],
    [envelope({ evidence: [] }), "invalid_observation"],
    [envelope({ evidence: [{ kind: "build-log", uri: "http://example.com/log", sha256: digest }] }), "invalid_observation"],
    [envelope({ evidence: [{ kind: "build-log", uri: "https://user:pw@example.com/log", sha256: digest }] }), "invalid_observation"],
    [envelope({ evidence: [{ kind: "build-log", uri: "https://example.com/log?X-Amz-Signature=abc", sha256: digest }] }), "invalid_observation"],
    [envelope({ evidence: [{ kind: "build-log", uri: "https://example.com/log", sha256: "not-a-digest" }] }), "invalid_observation"],
    [envelope({ finding: { observed: "token ghp_abcdefghijklmnopqrstuvwxyz0123" } }), "invalid_observation"],
    [envelope({ finding: { observed: "bad\u0007bell" } }), "invalid_observation"],
    [envelope({ top: { eventType: "verification.failed" } }), "invalid_observation"],
    [envelope({ observedAt: "2026-09-01T00:00:00Z" }), "stale_observation"],
    [envelope({ observedAt: "2026-10-08T13:00:00Z" }), "invalid_observation"]
  ];
  for (const [body, code] of cases) {
    await assert.rejects(intake.submit(body, token), error => error.code === code, JSON.stringify(body).slice(0, 120));
  }
  assert.equal(store.records.size, 0);
});

test("security findings are routed as restricted, never as ordinary private or public records", async () => {
  const { store, intake } = fixture();
  await intake.submit(envelope({ finding: { category: "security-finding" } }), auth("praxis-token-0000000000"));
  assert.equal([...store.records.values()][0].visibility, "restricted-security");
});

test("spec test 8: Vitium's own CI cannot create a reporting feedback loop", async () => {
  const { store, intake } = fixture();
  const own = envelope({ source: { system: "ci", repository: "kemiller2002/vitium" }, subject: { workItemId: null } });
  assert.equal((await intake.submit(own, auth("vitiumci-token-00000000"))).status, "received");
  // Vitium posts an issue update carrying its causation marker; the CI adapter reacts to it.
  const echo = envelope({ top: { eventId: "2276f8ac-a673-4d62-85a7-5d2292ef0cdd" },
    source: { system: "ci", repository: "kemiller2002/vitium" }, correlation: { causationEventId: "vitium:issue-update-17" } });
  const suppressed = await intake.submit(echo, auth("vitiumci-token-00000000"));
  assert.equal(suppressed.status, "suppressed");
  assert.equal((await intake.submit(own, auth("vitiumci-token-00000000"))).replayed, true);
  assert.equal(store.records.size, 1);
});

test("storage failures never acknowledge receipt", async () => {
  const broken = fixture({ store: { async putOnce() { throw new Error("throttled"); } } });
  await rejects(broken.intake.submit(envelope(), auth("praxis-token-0000000000")), "storage_unavailable", 503);
  const lying = fixture({ store: { async putOnce() { return {}; } } });
  await rejects(lying.intake.submit(envelope(), auth("praxis-token-0000000000")), "storage_unavailable", 503);
});

const request = (body, overrides = {}) => ({
  rawPath: "/api/v1/observations", requestContext: { http: { method: "POST" }, requestId: "req-1" },
  headers: { "content-type": "application/json", authorization: "Bearer praxis-token-0000000000" },
  body: JSON.stringify(body), ...overrides
});

test("machine HTTP boundary is separate from the public Turnstile route and refuses browsers", async () => {
  const { handle } = fixture();
  const created = await handle(request(envelope()));
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers["access-control-allow-origin"], undefined);
  assert.equal((await handle(request(envelope()))).statusCode, 200);
  const browser = await handle(request(envelope(), { headers: { origin: "https://vitium.echelonfoundry.com", "content-type": "application/json", authorization: "Bearer praxis-token-0000000000" } }));
  assert.equal(browser.statusCode, 403);
  assert.equal((await handle(request(envelope(), { rawPath: "/api/v1/reports" }))).statusCode, 404);
  assert.equal((await handle(request(envelope(), { headers: { "content-type": "text/plain", authorization: "Bearer praxis-token-0000000000" } }))).statusCode, 415);
  assert.equal((await handle(request(envelope(), { body: "x".repeat(40_000) }))).statusCode, 413);
  assert.equal((await handle(request(envelope(), { body: "{" }))).statusCode, 400);
  const anonymous = await handle(request(envelope(), { headers: { "content-type": "application/json" } }));
  assert.equal(anonymous.statusCode, 401);
  assert.ok(!anonymous.body.includes("Routing contract"), "errors do not echo observation content");
});
