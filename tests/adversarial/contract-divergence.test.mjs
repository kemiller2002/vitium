// Adversarial: divergence between the public site, the service and the schemas.
// Every test names the requirement / acceptance scenario it protects.
// Tests marked { todo: "finding VF-xxx" } FAIL against baseline bba1d59 and are
// verification findings; they stay in place until the owner fixes the cause.
import test from "node:test";
import assert from "node:assert/strict";
import * as site from "../../site/submission.mjs";
import * as domain from "../../service/report-domain.mjs";
import { defectStates } from "../../service/triage.mjs";
import { readRepo, readJson, schemaValidator, selectOptions, attempt, CHALLENGE } from "../verification/contracts.mjs";

const html = readRepo("site/index.html");
const requestSchema = readJson("schemas/intake-request.schema.json");
const defectSchema = readJson("schemas/defect.schema.json");
const validateRequest = schemaValidator("schemas/intake-request.schema.json");
const serviceNormalize = attempt(domain.normalizeReport);

const formInput = Object.freeze({
  product: "Forma", impact: "Not sure", title: "Save fails", actual: "Nothing happens.",
  expected: "It saves.", steps: "", pageUrl: "", privacyAcknowledged: true
});

// Mirrors site/app.mjs: body = {...normalizeReport(form), privacyAcknowledged:true, challengeToken}.
const clientWireBody = input => ({ ...site.normalizeReport(input), privacyAcknowledged: true, challengeToken: CHALLENGE });

test("VIT-DOM-004 / VIT-AC-010: product list identical across site JS, site HTML, service and request schema", () => {
  const lists = {
    siteJs: [...site.PRODUCTS],
    siteHtml: selectOptions(html, "product"),
    service: [...domain.products],
    schema: requestSchema.properties.product.enum
  };
  for (const [name, list] of Object.entries(lists)) {
    assert.deepEqual(list, lists.service, "product list diverges in " + name);
    assert.equal(new Set(list).size, list.length, "duplicate product in " + name);
  }
});

test("VIT-UX-002 / VIT-DOM-006: impact list identical across site JS, site HTML, service and request schema", () => {
  const lists = {
    siteJs: [...site.IMPACTS],
    siteHtml: selectOptions(html, "impact"),
    service: [...domain.impacts],
    schema: requestSchema.properties.impact.enum
  };
  for (const [name, list] of Object.entries(lists)) assert.deepEqual(list, lists.service, "impact list diverges in " + name);
});

test("VIT-DOM-004: product names that differ only by case/whitespace/homoglyph are not silently mapped", () => {
  for (const product of ["forma", "FORMA", "Forma Studio", "Fоrma" /* Cyrillic o */, "Forma ", "Other/not sure"]) {
    const r = serviceNormalize({ schemaVersion: "1.0", ...formInput, product });
    if (r.ok) assert.ok(domain.products.includes(r.value.product) && r.value.product === product.trim(), "silently mapped " + JSON.stringify(product) + " to " + r.value.product);
  }
});

test("VIT-AC-003 / VIT-API-001: the request the browser would send is accepted by the service runtime", () => {
  const body = clientWireBody(formInput);
  const result = serviceNormalize(body);
  assert.ok(result.ok, "service refused the client's own payload: " + JSON.stringify(result.error));
});

test("VIT-DOM-003 / VIT-AC-010: the request the browser would send validates against intake-request.schema.json", () => {
  const body = clientWireBody(formInput);
  const result = validateRequest(body);
  assert.ok(result.ok, "schema refused the client's payload: " + JSON.stringify(result.error));
});

test("VIT-API-002 / VIT-UX-007: a page URL accepted by the site is accepted by the service", { todo: "finding VF-011" }, () => {
  // 1,990 raw characters pass the site's pre-sanitisation 2,000 check, but inner
  // spaces are percent-encoded during sanitisation and the result exceeds the service limit.
  const pageUrl = "https://example.com/" + " x".repeat(985);
  assert.ok(pageUrl.length <= 2000);
  const draft = site.normalizeReport({ ...formInput, pageUrl });
  assert.ok(draft.pageUrl.length <= 2000, "site produced a " + draft.pageUrl.length + "-char sanitised URL that the server must refuse");
  assert.ok(serviceNormalize({ ...draft, schemaVersion: "1.0", privacyAcknowledged: true }).ok);
});

test("VIT-AC-008 / VIT-NFR-004: site and service agree on refusing credential-looking text", () => {
  for (const secret of ["sk-abcdefghijklmnopqrstuvwxyz", "password: hunter2hunter2", "ghp_abcdefghijklmnopqrstuvwxyz0123"]) {
    const server = serviceNormalize({ schemaVersion: "1.0", ...formInput, actual: secret });
    assert.equal(server.ok, false, "precondition: service refuses " + secret.slice(0, 6));
    const client = attempt(site.normalizeReport)({ ...formInput, actual: secret });
    const url = client.ok ? attempt(site.buildIssueUrl)(client.value) : { ok: false };
    assert.ok(!client.ok || !url.ok || !url.value.includes(encodeURIComponent(secret).slice(0, 10)),
      "legacy path places " + secret.slice(0, 6) + "… into a public GitHub URL");
  }
});

test("VIT-DOM-003 / VIT-LCY-004: every defect state used by triage.mjs is representable in defect.schema.json", () => {
  const schemaStates = defectSchema.properties.state.enum;
  assert.deepEqual(defectStates.filter(s => !schemaStates.includes(s)), []);
});

test("VIT-DOM-003 / VIT-DOM-006: intake impact labels have a declared mapping to defect.schema.json impact codes", () => {
  const codes = defectSchema.properties.impact.enum;
  const unmapped = domain.impacts.filter(label => !codes.includes(label));
  // A mapping module (or a shared enum) must exist; today the two vocabularies are disjoint.
  const mapping = domain.impactCodes ?? null;
  assert.ok(unmapped.length === 0 || (mapping && unmapped.every(l => codes.includes(mapping[l]))),
    "no mapping for: " + unmapped.join(", "));
});

test("VIT-NFR-008 / VIT-REP-011: third-party stylesheet is integrity-pinned (SRI) as well as version-pinned", { todo: "finding VF-018" }, () => {
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m => m[0]).filter(l => /href="https?:/.test(l));
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.match(link, /integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, link);
    assert.match(link, /crossorigin="anonymous"/, link);
  }
});

test("VIT-AC-015 / VIT-API-001: static site assets contain no credential material or private endpoints", () => {
  const files = ["site/index.html", "site/app.mjs", "site/submission.mjs", "site/public-config.mjs", "site/styles.css"];
  const secretish = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{18,}|xox[abpr]-[A-Za-z0-9-]{10,}|amazonaws\.com|execute-api)/;
  for (const file of files) assert.doesNotMatch(readRepo(file), secretish, file);
});
