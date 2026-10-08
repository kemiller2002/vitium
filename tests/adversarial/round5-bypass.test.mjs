// Fix round 5: bypass variants for VF-035 (operator caller classification) and VF-036
// (outbox delivery proof) beyond the round-4 tests. VIT-VER-011, mission §7 gate 4,
// VIT-AC-035/036. All variants are expected to be refused on p0/integration @ 691097c.
import test from "node:test";
import assert from "node:assert/strict";
import { parseHumanRoleAllowList, classifyCaller } from "../../service/operator-identity.mjs";
import { decide } from "../../service/triage-cli.mjs";
import { enqueue, createOutboxEntry, nextDelivery, DEFAULT_POLICY } from "../../service/machine/outbox.mjs";

const ACCT = "123456789012";
const ALLOW = parseHumanRoleAllowList(`arn:aws:iam::${ACCT}:role/ops/humans/Triager , arn:aws-us-gov:iam::${ACCT}:role/GovTriager`).value;
const sts = (rest, partition = "aws", account = ACCT) => `arn:${partition}:sts::${account}:${rest}`;

test("VF-035 control: an allow-listed human role session (any partition on the list) is authenticated-human", () => {
  assert.equal(classifyCaller(sts("assumed-role/Triager/alice"), ALLOW).provenance, "authenticated-human");
  assert.equal(classifyCaller(sts("assumed-role/GovTriager/alice", "aws-us-gov"), ALLOW).provenance, "authenticated-human");
});

test("VF-035 variant: path tricks, partition swaps, case, whitespace, zero-width and non-role identities are agents", () => {
  for (const arn of [
    sts("assumed-role/Triager/alice") + " ", " " + sts("assumed-role/Triager/alice"), sts("assumed-role/Triager/alice") + "\n",
    sts("assumed-role/triager/alice"), sts("assumed-role/Triager​/alice"),
    sts("assumed-role/Triager/../Other"), sts("assumed-role/Other/../Triager"), sts("assumed-role/ops/humans/Triager/alice"),
    sts("assumed-role/Triager/alice/extra"),
    sts("assumed-role/Triager/alice", "aws-us-gov"), sts("assumed-role/GovTriager/alice"), sts("assumed-role/Triager/alice", "aws-cn"),
    sts("assumed-role/Triager/alice", "aws", "999999999999"),
    `arn:aws:iam::${ACCT}:user/Triager`, sts("federated-user/Triager"), `arn:aws:iam::${ACCT}:root`,
    "ARN:AWS:STS::" + ACCT + ":assumed-role/Triager/alice", "", null, undefined, 42
  ]) {
    assert.equal(classifyCaller(arn, ALLOW).provenance, "agent", JSON.stringify(arn));
  }
});

test("VF-035 variant: wildcard, malformed and zero-width allow-list entries fail the whole configuration; unset means nobody is human", () => {
  for (const text of ["*", `arn:aws:iam::${ACCT}:role/*`, `arn:aws:iam::${ACCT}:role/Tri ager`, `arn:aws:iam::${ACCT}:role/Triager​`, `arn:aws:iam::${ACCT}:role/Triager,garbage`]) {
    assert.equal(parseHumanRoleAllowList(text).ok, false, text);
  }
  for (const text of [undefined, "", "   "]) {
    const list = parseHumanRoleAllowList(text);
    assert.deepEqual(list.value, []);
    assert.equal(classifyCaller(sts("assumed-role/Triager/alice"), list.value).provenance, "agent");
  }
  assert.equal(classifyCaller(sts("assumed-role/Triager/alice"), { find: () => true }).provenance, "agent", "non-array allow-list");
});

test("VF-035 variant: decide() without a provenance (or with any non-human value) runs as an agent", () => {
  const rec = { kind: "defect", id: "DEF-0001", state: "awaiting-verification", revision: 1, history: [{ type: "transition", to: "awaiting-verification", actor: "dev-1", fields: { attemptId: "A1", candidateRevision: "c1", author: "dev-1" }, sequence: 1 }] };
  const args = { command: "advance", to: "resolved", reason: "verified", role: "verifier", fields: { attemptId: "A1", candidateRevision: "c1" }, evidence: [{ kind: "verification-run", ref: "run-1" }] };
  for (const provenance of [undefined, "agent", "Authenticated-Human", "authenticated-human ", "ci"]) {
    const r = decide({ args, record: rec, actor: "arn:aws:sts::" + ACCT + ":assumed-role/Runner/s1", occurredAt: "2026-10-08T12:00:00.000Z", provenance });
    assert.equal(r.ok, false, String(provenance));
    assert.equal(r.error.code, "human_verifier_required", String(provenance));
  }
});

const NOW = "2026-10-08T12:00:00.000Z";
const ack = principalId => ({ schemaVersion: "1.0", eventId: "e1", principalId, observationId: "OBS-1", receivedAt: NOW, status: "recorded", replayed: false });
const deliver = (entry, body) => nextDelivery(entry, NOW, DEFAULT_POLICY, { kind: "response", status: 200, body }).value;

test("VF-036 variant: principal-less, whitespace-padded or post-hoc-cleared principals can never be marked delivered", () => {
  for (const entry of [enqueue({ eventId: "e1" }, NOW), enqueue({ eventId: "e1" }, NOW, " wl:ci:summa"), { ...createOutboxEntry({ eventId: "e1" }, NOW, "wl:ci:summa").value, principalId: undefined }]) {
    const r = deliver(entry, ack("wl:anyone"));
    assert.notEqual(r.status, "delivered");
    assert.equal(r.deadLetterReason, "missing-principal");
  }
  assert.equal(createOutboxEntry({ eventId: "e1" }, NOW, "").error?.code, "missing_principal");
});

test("VF-036 variant: with a principal, only an exact principal match is delivery (no whitespace or case folding)", () => {
  const entry = createOutboxEntry({ eventId: "e1" }, NOW, "wl:ci:summa").value;
  assert.equal(deliver(entry, ack("wl:ci:summa")).status, "delivered");
  for (const p of ["wl:ci:summa ", "WL:CI:SUMMA", "wl:ci:summa​"]) assert.notEqual(deliver(entry, ack(p)).status, "delivered", JSON.stringify(p));
});
