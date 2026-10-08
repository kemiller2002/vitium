import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const spec = read("docs/requirements/VITIUM-REQUIREMENTS.md");
const acceptance = read("docs/requirements/VITIUM-ACCEPTANCE.md");
const decisions = read("docs/requirements/VITIUM-OPEN-DECISIONS.md");

function ids(source, expression) {
  return [...source.matchAll(expression)].map(match => match[1]);
}

const requirementIds = ids(spec, /^\|\s*(VIT-(?:UX|DOM|API|LCY|INT|VER|OPS|NFR)-\d{3})\s*\|/gm);
const scenarioIds = ids(acceptance, /^\|\s*(VIT-AC-\d{3})\s*\|/gm);
const decisionIds = ids(decisions, /^\|\s*(VIT-OQ-\d{3})\s*\|/gm);

test("requirements and scenario identifiers are unique to prevent accidental overwriting", () => {
  for (const [name, entries] of [
    ["requirement", requirementIds],
    ["acceptance", scenarioIds],
    ["open decision", decisionIds]
  ]) {
    assert.ok(entries.length > 0, name + " IDs are missing");
    assert.equal(new Set(entries).size, entries.length, "duplicate " + name + " IDs");
  }
});

test("all product requirement groups are covered", () => {
  for (const group of ["UX", "DOM", "API", "LCY", "INT", "VER", "OPS", "NFR"]) {
    assert.ok(requirementIds.some(id => id.startsWith("VIT-" + group + "-")), "missing group " + group);
  }
});

test("requirement rows declare a delivery stage and a verifiable obligation", () => {
  for (const line of spec.split("\n").filter(line => /^\|\s*VIT-(UX|DOM|API|LCY|INT|VER|OPS|NFR)-\d{3}\s*\|/.test(line))) {
    const cells = line.split("|").map(s => s.trim());
    assert.match(cells[2], /^P[012]$/, "missing stage for " + cells[1]);
    assert.match(cells[3], /\b(MUST|SHOULD)\b/, "missing normative verb for " + cells[1]);
  }
});

test("acceptance contract covers each mandatory release stage with negative checks", () => {
  for (const scenario of ["VIT-AC-001","VIT-AC-003","VIT-AC-004","VIT-AC-006","VIT-AC-008","VIT-AC-009","VIT-AC-011","VIT-AC-013","VIT-AC-014","VIT-AC-015"]) {
    assert.ok(scenarioIds.includes(scenario), "missing P0 acceptance " + scenario);
  }
  assert.match(acceptance, /not verified by this document/i);
  assert.match(acceptance, /verified-passed/);
});

test("unapproved security and architectural decisions remain visibly open", () => {
  assert.match(decisions, /^status: open$/m);
  assert.match(spec, /^status: proposed$/m);
  for (const decision of ["VIT-OQ-001","VIT-OQ-002","VIT-OQ-003","VIT-OQ-004","VIT-OQ-005","VIT-OQ-008","VIT-OQ-017","VIT-OQ-018"]) {
    assert.ok(decisionIds.includes(decision), "decision silently lost: " + decision);
  }
});

test("requirements are not mislabeled as deployed product functionality", () => {
  assert.match(spec, /not a claim that Vitium is implemented/i);
  assert.match(spec, /requirements freeze is not claimed/i);
  assert.match(decisions, /proposals.*not settled user decisions/i);
});
