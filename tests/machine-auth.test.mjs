// VIT-INT-016 / VIT-AC-035: workload identity port and pure authorization.
// Requirements doc "Required tests" item 3: forged identity, mismatched repo scope,
// expired workload token fail safely; caller-supplied source names are never proof.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, isVerifiedPrincipal, makePrincipalVerifier } from "../service/machine/principal.mjs";
import { validateEnvelope } from "../service/machine/contract.mjs";
import { NOW, CLAIMS, example, body, principal, verify, harness } from "./machine-fixtures.mjs";

const env = name => validateEnvelope(example(name)).value;

test("a principal exists only when minted by the verifier port", async () => {
  const p = await principal("label-ci");
  assert.equal(isVerifiedPrincipal(p), true);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.repositories));
  assert.equal(authorize(p, env("observation-detected.ci.v1.json"), NOW).ok, true);
});

test("forged principals are refused: literal, JSON round-trip, spread and structuredClone copies", async () => {
  const real = await principal("label-ci");
  const forgeries = [
    { ...CLAIMS["label-ci"] },
    JSON.parse(JSON.stringify(real)),
    { ...real },
    structuredClone(real),
    Object.freeze(Object.assign(Object.create(Object.getPrototypeOf(real)), real))
  ];
  for (const forged of forgeries) {
    assert.deepEqual(forged, { ...real }, "forgery is structurally identical");
    assert.equal(isVerifiedPrincipal(forged), false);
    const r = authorize(forged, env("observation-detected.ci.v1.json"), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_principal");
  }
});

test("a verified principal's scopes cannot be widened after verification", async () => {
  const p = await principal("label-ci-detect-only");
  assert.throws(() => { "use strict"; p.eventTypes.push("verification.passed"); }, TypeError);
  assert.throws(() => { "use strict"; p.repositories[0] = "kemiller2002/other"; }, TypeError);
  assert.equal(authorize(p, env("verification-inconclusive.ci.v1.json"), NOW).error.code, "event_type_not_in_scope");
});

test("verifier port failures are typed: no credential, rejected, unavailable, throws, malformed claims", async () => {
  assert.equal((await verify(undefined)).error.code, "unauthenticated");
  assert.equal((await verify("")).error.code, "unauthenticated");
  assert.equal((await verify("label-unknown")).error.code, "unauthenticated");
  assert.equal((await verify("label-unavailable")).error.code, "authentication_unavailable");
  const throwing = makePrincipalVerifier(async () => { throw new Error("network down"); });
  assert.equal((await throwing("x")).error.code, "authentication_unavailable");
  const garbage = makePrincipalVerifier(async () => "yes");
  assert.equal((await garbage("x")).error.code, "authentication_unavailable");
  const wide = makePrincipalVerifier(async () => ({ ok: true, value: { ...CLAIMS["label-ci"], admin: true } }));
  assert.equal((await wide("x")).error.code, "invalid_principal");
  const noRepos = makePrincipalVerifier(async () => ({ ok: true, value: { ...CLAIMS["label-ci"], repositories: [] } }));
  assert.equal((await noRepos("x")).error.code, "invalid_principal");
  const wildcard = makePrincipalVerifier(async () => ({ ok: true, value: { ...CLAIMS["label-ci"], repositories: ["*"] } }));
  assert.equal((await wildcard("x")).error.code, "invalid_principal");
  assert.throws(() => makePrincipalVerifier(undefined), TypeError);
});

test("authorization refusals: missing, expired, forged source.system/repository, out-of-scope repo/env/type", async () => {
  const ci = await principal("label-ci");
  const base = env("observation-detected.ci.v1.json");
  const code = (p, e) => authorize(p, e, NOW).error?.code;
  assert.equal(code(undefined, base), "unauthenticated");
  assert.equal(code(null, base), "unauthenticated");
  assert.equal(code(await principal("label-ci-expired"), base), "principal_expired");
  assert.equal(authorize(ci, base, "not-a-time").error.code, "principal_expired", "unknown time fails closed");
  // Caller claims to be praxis while authenticated as ci: forged identity.
  assert.equal(code(ci, { ...base, source: { ...base.source, system: "praxis" } }), "identity_mismatch");
  // Caller names a repository outside its scope.
  assert.equal(code(ci, { ...base, source: { ...base.source, repository: "kemiller2002/other" } }), "repository_not_in_scope");
  assert.equal(code(await principal("label-ci-other-repo"), base), "repository_not_in_scope");
  assert.equal(code(await principal("label-ci-prod-only"), base), "environment_not_in_scope");
  assert.equal(code(await principal("label-ci-detect-only"), env("verification-inconclusive.ci.v1.json")), "event_type_not_in_scope");
  // An ordo principal may only send governance violations.
  assert.equal(code(await principal("label-ordo"), { ...base, source: { ...base.source, system: "ordo" } }), "event_type_not_in_scope");
});

test("intake refuses before parsing when unauthenticated or forged, and writes nothing", async () => {
  const { intake, store } = harness();
  const b = body(example("observation-detected.ci.v1.json"));
  assert.equal((await intake.submit({ body: b })).error.code, "unauthenticated");
  assert.equal((await intake.submit({ principal: { ...CLAIMS["label-ci"] }, body: b })).error.code, "invalid_principal");
  assert.equal((await intake.submit({ principal: { ...CLAIMS["label-ci"] }, body: "{not json" })).error.code, "invalid_principal", "no parse oracle for forged callers");
  const forgedSource = example("observation-detected.ci.v1.json");
  forgedSource.source.system = "praxis";
  assert.equal((await intake.submit({ principal: await principal("label-ci"), body: body(forgedSource) })).error.code, "identity_mismatch");
  const otherRepo = example("observation-detected.ci.v1.json");
  otherRepo.source.repository = "kemiller2002/other";
  assert.equal((await intake.submit({ principal: await principal("label-ci"), body: body(otherRepo) })).error.code, "repository_not_in_scope");
  assert.equal((await intake.submit({ principal: await principal("label-ci-expired"), body: b })).error.code, "principal_expired");
  assert.equal(store.records().length, 0);
});

test("credentials in the body are refused with a dedicated code, wherever they appear", async () => {
  const { intake, store } = harness();
  const p = await principal("label-ci");
  for (const inject of [
    v => { v.token = "opaque"; },
    v => { v.source.credential = "opaque"; },
    v => { v.correlation.Authorization = "opaque"; },
    v => { v.evidence[0].id_token = "opaque"; },
    v => { v.principal = { principalId: "wl:admin", system: "ci" }; }
  ]) {
    const v = example("observation-detected.ci.v1.json");
    inject(v);
    const r = await intake.submit({ principal: p, body: body(v) });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "credential_in_body");
    assert.equal(JSON.stringify(r.error).includes("opaque"), false, "refusal never echoes the value");
  }
  assert.equal(store.records().length, 0);
});
