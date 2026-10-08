// VIT-NFR-005 / VIT-API-006 / VIT-API-007: operational runbooks exist, link the right
// acceptance IDs, and keep undecided policy explicitly undecided (no invented owners/numbers).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const OPS = ["PAGES-DNS-TLS", "STAGING-READINESS", "INCIDENT-AND-ESCALATION", "ROLLBACK-AND-DR", "DATA-HANDLING", "OPERATOR-DECISIONS"]
  .map(n => `docs/operations/${n}.md`);

test("all operations runbooks exist", () => {
  for (const p of OPS) assert.ok(existsSync(new URL("../" + p, import.meta.url)), p);
});

test("owner tables use UNASSIGNED rather than invented people", () => {
  const incident = read("docs/operations/INCIDENT-AND-ESCALATION.md");
  const rows = incident.split("\n").filter(l => /^\| (Security contact|Privacy\/data owner|Triage\/moderation operator|AWS account operator|Repository\/Pages operator) \|/.test(l));
  assert.equal(rows.length, 5);
  for (const row of rows) {
    const [, , , primary, backup] = row.split("|").map(s => s.trim());
    assert.equal(primary, "UNASSIGNED", row);
    assert.equal(backup, "UNASSIGNED", row);
  }
  const register = read("docs/operations/OPERATOR-DECISIONS.md");
  const decisionRows = register.split("\n").filter(l => /^\| D-\d{2} \|/.test(l));
  assert.ok(decisionRows.length >= 20);
  for (const row of decisionRows) assert.match(row.split("|")[3], /UNASSIGNED/, row);
});

test("retention, RPO/RTO and deadlines are not invented", () => {
  const data = read("docs/operations/DATA-HANDLING.md");
  const schedule = data.split("## 2.")[1].split("## 3.")[0];
  const policyRows = schedule.split("\n").filter(l => /^\| (Unreviewed|Rejected|Accepted)/.test(l));
  assert.equal(policyRows.length, 3);
  policyRows.forEach(r => assert.match(r, /\| UNDECIDED \| UNDECIDED \| UNASSIGNED \|/));
  const dr = read("docs/operations/ROLLBACK-AND-DR.md");
  assert.match(dr, /RPO\/RTO: \*\*operator decisions, not set here/);
  assert.doesNotMatch(dr, /RPO\s*(=|:|of)\s*\d|RTO\s*(=|:|of)\s*\d/i);
});

test("register covers every required operator action and maps to acceptance and VIT-OQ IDs", () => {
  const register = read("docs/operations/OPERATOR-DECISIONS.md");
  for (const topic of ["Enable Pages", "DNS CNAME", "Enforce HTTPS", "AWS account", "region", "Turnstile", "Moderation", "Retention", "Privacy notice", "Budget", "Security contact"]) {
    assert.match(register, new RegExp(topic, "i"), topic);
  }
  for (const id of ["VIT-AC-014", "VIT-AC-015", "VIT-AC-008", "VIT-OQ-008", "VIT-OQ-009"]) assert.ok(register.includes(id), id);
});

test("runbooks never instruct enabling intake or deploying without approval", () => {
  const staging = read("docs/operations/STAGING-READINESS.md");
  assert.match(staging, /\*\*NOT DEPLOYED\.\*\*/);
  assert.match(staging, /--stack-name vitium-intake-staging/);
  assert.match(staging, /--no-execute-changeset/);
  assert.doesNotMatch(staging, /--stack-name vitium-intake-production|--guided/);
  assert.match(read("docs/operations/ROLLBACK-AND-DR.md"), /enabled: false/);
});

test("machine-reporting decisions exist, are undecided/unassigned and map to INT-013..018 and AC-032/035", () => {
  const register = read("docs/operations/OPERATOR-DECISIONS.md");
  const rows = register.split("\n").filter(l => /^\| M-\d{2} \|/.test(l));
  assert.ok(rows.length >= 8, `expected machine-reporting decisions, got ${rows.length}`);
  for (const row of rows) {
    const cells = row.split("|").map(s => s.trim());
    assert.equal(cells[3], "UNASSIGNED", row);
    assert.match(cells[4], /UNDECIDED/, row);
    assert.match(cells[6], /VIT-INT-01[3-8]/, row);
    assert.match(cells[7], /VIT-AC-03[25]/, row);
  }
  for (const topic of ["Workload identity", "audience", "per producer", "hostname", "rotation", "outbox", "self-reporting", "upstream producer PRs"]) {
    assert.ok(rows.some(r => r.toLowerCase().includes(topic.toLowerCase())), topic);
  }
  for (const id of ["VIT-INT-013", "VIT-INT-014", "VIT-INT-015", "VIT-INT-016", "VIT-INT-017", "VIT-INT-018", "VIT-AC-032", "VIT-AC-035"]) {
    assert.ok(rows.some(r => r.includes(id)), id);
  }
});

test("D-25 human operator roles: no default, owner unassigned, referenced from staging E2E", () => {
  const register = read("docs/operations/OPERATOR-DECISIONS.md");
  const row = register.split("\n").find(l => l.startsWith("| D-25 |"));
  assert.ok(row, "D-25 row missing");
  const cells = row.split("|").map(s => s.trim());
  assert.equal(cells[3], "UNASSIGNED");
  assert.match(cells[4], /VITIUM_HUMAN_OPERATOR_ROLE_ARNS/);
  assert.match(cells[4], /No default/);
  assert.match(cells[5], /human_verifier_required/);
  assert.match(cells[6], /VIT-AC-011/);
  assert.match(cells[6], /VIT-AC-036/);
  assert.match(cells[7], /VIT-OQ-008/);
  assert.match(cells[7], /VIT-OQ-012/);
  assert.doesNotMatch(row, /arn:aws:iam::\d{12}:role\//, "no invented concrete role ARNs");
  const staging = read("docs/operations/STAGING-READINESS.md");
  assert.match(staging, /D-25/);
  assert.match(staging, /^\| E15 \|.*VITIUM_HUMAN_OPERATOR_ROLE_ARNS/m);
});
