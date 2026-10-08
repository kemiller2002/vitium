// VIT-AC-015 / VIT-NFR-004 server side: secret canaries placed in every reporter-controlled
// input and in every effect failure must never appear in a log line, an HTTP response, or
// (unredacted) in the stored record. Uses a captured logger effect.
import test from "node:test";
import assert from "node:assert/strict";
import {makeIntake} from "../service/intake.mjs";
import {createHttpHandler} from "../service/http.mjs";
import {redactText} from "../service/redaction.mjs";

const origin = "https://vitium.echelonfoundry.com";
// Canaries are synthetic and shaped like real credentials so the detectors must work.
// They are assembled at runtime so no committed line matches a credential pattern.
const j = (...parts) => parts.join("");
const CANARY = Object.freeze({
  github: j("gh", "p_", "CANARYc4n4ryC4N4RYc4n4ryC4N4RY01"),
  aws: j("AK", "IA", "CANARY0CANARY0XY"),
  bearer: j("Bea", "rer ", "canaryBearer0123456789abcdefCANARY"),
  urlPassword: j("https://", "ops", ":", "canaryUrlPass99", "@", "status.example.net/a"),
  query: "canaryQuerySecret0042",
  challenge: "turnstile-canary-token-0123456789",
  ip: "198.51.100.23",
  ua: "CanaryAgent/9.9",
  infra: "arn:aws:dynamodb:canary-infra-detail",
  password: "canaryPassw0rd!"
});
const canaryReport = {
  schemaVersion:"1.0", product:"Forma", impact:"Not sure",
  title:"Login broken " + CANARY.github,
  actual:"Our key " + CANARY.aws + " and header Authorization: " + CANARY.bearer + " fail; see " + CANARY.urlPassword,
  expected:"password: " + CANARY.password,
  steps:"Call ?access_token=" + CANARY.query,
  pageUrl:"https://app.example.com/p?token=" + CANARY.query + "#x",
  privacyAcknowledged:true
};
const event = (key, body = canaryReport) => ({
  rawPath:"/api/v1/reports",
  requestContext:{http:{method:"POST", sourceIp:CANARY.ip, userAgent:CANARY.ua}, requestId:"req-canary"},
  headers:{origin, "content-type":"application/json", "idempotency-key":key, "user-agent":CANARY.ua, "x-forwarded-for":CANARY.ip},
  body:JSON.stringify({...body, challengeToken:CANARY.challenge})
});
const allCanaries = Object.values(CANARY).map(v => v.replace(/^Bearer /, ""));
function assertClean(label, text) {
  for (const c of allCanaries) assert.ok(!text.includes(c), label + " leaked canary " + c.slice(0, 10));
}

function scenario({store, verifyChallenge}) {
  const lines = [];
  const records = new Map();
  const defaultStore = {async putOnce(item){
    if (records.has(item.pk)) {
      const f = records.get(item.pk);
      return {ok:true, value:{created:false, existing:{reference:f.reference, payloadHash:f.payloadHash, receivedAt:f.receivedAt, disposition:f.disposition}}};
    }
    records.set(item.pk, item); return {ok:true, value:{created:true}};
  }};
  const service = makeIntake({store:store ?? defaultStore, verifyChallenge:verifyChallenge ?? (async () => ({ok:true, value:true}))});
  const handle = createHttpHandler(service, {log: record => lines.push(JSON.stringify(record))});
  return {lines, records, handle};
}

test("T-20 canaries never appear in logs, responses or stored records across all outcomes", async () => {
  const key = "0f1e2d3c-4b5a-4968-8776-655443322110";
  const runs = [];
  // accepted (quarantined), replayed, conflict
  const main = scenario({});
  runs.push(["accepted", await main.handle(event(key)), main]);
  runs.push(["replayed", await main.handle(event(key)), main]);
  runs.push(["conflict", await main.handle(event(key, {...canaryReport, title:"other " + CANARY.github})), main]);
  // validation failure echoing nothing
  const invalid = scenario({});
  runs.push(["validation", await invalid.handle(event(key, {...canaryReport, product:"Nope " + CANARY.github})), invalid]);
  // effect failures whose error messages contain canaries
  const storeDown = scenario({store:{async putOnce(){ throw new Error("store down " + CANARY.infra + " " + CANARY.password); }}});
  runs.push(["store-throws", await storeDown.handle(event(key)), storeDown]);
  const challengeDown = scenario({verifyChallenge: async () => { throw new Error("provider " + CANARY.challenge); }});
  runs.push(["challenge-throws", await challengeDown.handle(event(key)), challengeDown]);
  const crash = scenario({});
  const crashHandle = createHttpHandler({submit: async () => { throw new Error("bug " + CANARY.infra); }}, {log: r => crash.lines.push(JSON.stringify(r))});
  runs.push(["core-throws", await crashHandle(event(key)), crash]);

  for (const [label, reply, ctx] of runs) {
    assertClean(label + " response", reply.body + JSON.stringify(reply.headers));
    for (const line of ctx.lines) assertClean(label + " log", line);
    assert.ok(ctx.lines.length >= 1, label + " emitted no log line");
  }
  const stored = [...main.records.values()];
  assert.equal(stored.length, 1);
  assertClean("stored record", JSON.stringify(stored[0]));
  assert.equal(stored[0].state, "quarantined");
  assert.ok(stored[0].screening.flags.includes("credential-redacted"));
  for (const kind of ["github-token", "aws-access-key-id", "authorization-header", "url-credentials", "url-secret-parameter", "credential-assignment"]) {
    assert.ok(stored[0].screening.redactions.includes(kind), "missing redaction kind " + kind);
  }
  // Remaining non-secret context is preserved for triage.
  assert.match(stored[0].report.title, /^Login broken \[redacted\]$/);
  assert.equal(stored[0].report.pageUrl, "https://app.example.com/p");
});

test("T-21 log records are allow-listed: no free text, keys, tokens, IPs or user agents", async () => {
  const {lines, handle} = scenario({});
  await handle(event("0f1e2d3c-4b5a-4968-8776-655443322111"));
  const record = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(record).sort(), ["category", "code", "disposition", "event", "flags", "redactions", "replayed", "requestId", "status"].filter(k => record[k] !== undefined).sort());
  assert.ok(!lines[0].includes("0f1e2d3c"), "idempotency key must not be logged");
});

test("T-22 redactor: false positives stay readable, true positives are removed", () => {
  for (const benign of ["Basic authentication page fails", "The token field is empty", "Password reset email never arrives", "Order 4111 1111 1111 1112 failed"]) {
    assert.equal(redactText(benign).text, benign, benign);
  }
  for (const secret of ["4111 1111 1111 1111", j("-----BEGIN ", "RSA PRIVATE", " KEY-----\nMIIabc\n-----END ", "RSA PRIVATE", " KEY-----"), j("xo", "xb-", "1234567890-abcdefghij"), j("sk", "_live_", "ABCDEFGHIJKLMNOPQRSTuvwx")]) {
    const r = redactText("before " + secret + " after");
    assert.ok(!r.text.includes(secret), secret.slice(0, 12));
    assert.ok(r.findings.length > 0);
  }
});
