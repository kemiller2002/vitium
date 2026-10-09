import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const readIfPresent = path => (existsSync(new URL("../" + path, import.meta.url)) ? read(path) : undefined);
const manifest = JSON.parse(read("conditor.json"));
const html = read("site/index.html");
const deployment = read("DEPLOYMENT.md");

test("canonical public origin is exact in SEO metadata and deployment contract", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/vitium\.echelonfoundry\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/vitium\.echelonfoundry\.com\/">/);
  assert.match(deployment, /https:\/\/vitium\.echelonfoundry\.com\//);
  assert.doesNotMatch(html, /https:\/\/kemiller2002\.github\.io\/vitium\/?/);
});

test("Conditor manifest declares exactly qualified initial lifecycle versions", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, "vitium");
  const components = Object.fromEntries(manifest.components.map(x => [x.id, x.version]));
  assert.deepEqual(components, {
    praxis: "3.7.2",
    ordo: "1.5.0",
    "visual-engineering": "1.0.1",
    "communication-engineering": "1.0.0"
  });
  assert.equal(manifest.components.length, Object.keys(components).length);
  assert.ok(manifest.components.every(x => x.required === true));
  assert.equal(manifest.execution.enabled, false);
  assert.equal(manifest.scaffold, undefined, "Do not claim an installed scaffold while migration is outstanding");
});

test("report form retains explicit public-data and GitHub handoff disclosures", () => {
  assert.match(html, /GitHub Issues in this repository are public/);
  assert.match(html, /A GitHub account is currently required to submit/);
  assert.match(html, /You must sign in to GitHub and select/);
  assert.match(html, /id="privacyAcknowledged" required/);
  assert.match(html, /id="review"/);
  assert.match(html, /data-testid="github-submit"/);
});

test("reporting remains accessible to keyboard-driven and machine-driven clients", () => {
  for (const id of ["product","impact","title","actual","expected","steps","pageUrl"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(html, new RegExp('for="' + id + '"'));
  }
  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="feedback" role="alert"/);
  assert.match(html, /id="edit"/);
  assert.match(read("site/styles.css"), /:focus-visible/);
});

test("deployment instructions do not confuse GitHub Actions and branch-hosted CNAME files", () => {
  assert.match(deployment, /GitHub Actions workflow/);
  assert.match(deployment, /CNAME/);
  assert.match(deployment, /kemiller2002\.github\.io/);
  assert.match(deployment, /CNAME file.*ignored/);
});

// ---------------------------------------------------------------------------
// Committed Conditor/Praxis/Ordo installed state (Praxis VIT-P0-GOV-001).
// Pure checks over file contents return { ok, value } / { ok, error }; the
// file-system reads happen once, below. Expectations are derived from
// conditor.json, never hard-coded, so a version change must go through
// Conditor (plan/upgrade) rather than by editing a single file.
// ---------------------------------------------------------------------------

const ok = value => ({ ok: true, value });
const fail = error => ({ ok: false, error });

const parseJson = (label, text) => {
  if (typeof text !== "string") return fail(`${label} is missing`);
  try {
    return ok(JSON.parse(text));
  } catch (error) {
    return fail(`${label} is not valid JSON: ${error.message}`);
  }
};

const sha256 = text => createHash("sha256").update(text, "utf8").digest("hex");
const isSha256 = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const isExactVersion = value => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
const pinsFullCommit = value => /#[0-9a-f]{40}(\||$)/.test(value);

// The lock binds byte-for-byte to the committed conditor.json and records the
// same declaration and project.
const checkLockBindsManifest = (manifestText, lockText) => {
  const manifestResult = parseJson("conditor.json", manifestText);
  if (!manifestResult.ok) return manifestResult;
  const lockResult = parseJson(".conditor/lock.json", lockText);
  if (!lockResult.ok) return lockResult;
  const lock = lockResult.value;
  const declared = manifestResult.value;
  const actual = sha256(manifestText);
  if (lock.manifestSha256 !== actual)
    return fail(`lock manifestSha256 ${lock.manifestSha256} does not match conditor.json sha256 ${actual}`);
  if (JSON.stringify(lock.manifest) !== JSON.stringify(declared))
    return fail("lock.manifest differs from conditor.json");
  if (lock.project !== declared.name)
    return fail(`lock project '${lock.project}' differs from manifest name '${declared.name}'`);
  return ok({ manifest: declared, lock });
};

// Every declared component is locked exactly once at its declared version
// with immutable release authority; nothing undeclared is locked.
const checkLockComponents = (declaration, lock) => {
  const declared = new Map(declaration.components.map(c => [c.id, c.version]));
  const locked = Array.isArray(lock.components) ? lock.components : [];
  const lockedIds = locked.map(c => c.id);
  const source = c => (typeof c.sourceReference === "string" ? c.sourceReference : "");
  const problems = [
    ...(new Set(lockedIds).size === lockedIds.length ? [] : ["lock lists a component more than once"]),
    ...[...declared.keys()].filter(id => !lockedIds.includes(id)).map(id => `declared component '${id}' is not locked`),
    ...locked.filter(c => !declared.has(c.id)).map(c => `locked component '${c.id}' is not declared`),
    ...locked
      .filter(c => declared.has(c.id) && declared.get(c.id) !== c.version)
      .map(c => `component '${c.id}' locked at ${c.version} but declared ${declared.get(c.id)}`),
    ...locked.filter(c => !isExactVersion(c.version)).map(c => `component '${c.id}' has non-exact version '${c.version}'`),
    ...locked.filter(c => !isSha256(c.descriptorSha256)).map(c => `component '${c.id}' lacks a sha256 descriptor digest`),
    ...locked.filter(c => source(c) === "").map(c => `component '${c.id}' lacks a source reference`),
    ...locked
      .filter(c => source(c).startsWith("github:") && !pinsFullCommit(source(c)))
      .map(c => `component '${c.id}' GitHub source is not pinned to a full commit`),
    ...locked
      .filter(c => source(c) !== "" && !source(c).startsWith("github:") && !source(c).endsWith(`@${c.version}`))
      .map(c => `component '${c.id}' source '${source(c)}' is not pinned to ${c.version}`)
  ];
  return problems.length === 0 ? ok(locked) : fail(problems.join("; "));
};

// Each component's own installation record and the shared toolchain pins
// agree with the declared versions.
const installationRecordPaths = {
  praxis: ".echelon/ros.json",
  ordo: ".echelon/sde.json",
  "visual-engineering": ".echelon/visual-engineering.json",
  "communication-engineering": ".echelon/communication-engineering.json"
};

const checkInstallationRecords = (declaration, records) => {
  const declared = Object.fromEntries(declaration.components.map(c => [c.id, c.version]));
  const recordProblems = Object.keys(declared).flatMap(id => {
    if (!(id in installationRecordPaths)) return [`no known installation record for declared component '${id}'`];
    const path = installationRecordPaths[id];
    const parsed = parseJson(path, records[path]);
    if (!parsed.ok) return [parsed.error];
    return parsed.value.installedVersion === declared[id]
      ? []
      : [`${path} reports ${parsed.value.installedVersion} but conditor.json declares ${declared[id]}`];
  });
  const toolchain = parseJson(".echelon/toolchain.json", records[".echelon/toolchain.json"]);
  const pinProblems = !toolchain.ok
    ? [toolchain.error]
    : ["praxis", "ordo"]
        .filter(id => id in declared && toolchain.value[id] !== declared[id])
        .map(id => `.echelon/toolchain.json pins ${id} ${toolchain.value[id]} but conditor.json declares ${declared[id]}`);
  const problems = [...recordProblems, ...pinProblems];
  return problems.length === 0 ? ok(true) : fail(problems.join("; "));
};

// Generated state must not bake in machine-local absolute paths or tokens,
// which would also make CI verification non-reproducible.
const leakPatterns = [
  [/\/tmp\//, "an absolute /tmp path"],
  [/\/home\/[^/\s"]+\//, "an absolute /home path"],
  [/\/Users\/[^/\s"]+\//, "an absolute /Users path"],
  [/\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "a GitHub fine-grained token"],
  [/AKIA[0-9A-Z]{16}/, "an AWS access key id"]
];

const checkNoLocalLeaks = files => {
  const problems = Object.entries(files).flatMap(([path, text]) =>
    leakPatterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => `${path} contains ${label}`));
  return problems.length === 0 ? ok(true) : fail(problems.join("; "));
};

// --- effects: read the committed state once ---------------------------------

const listFiles = relative => {
  const url = new URL("../" + relative, import.meta.url);
  if (!existsSync(url)) return [];
  if (!statSync(url).isDirectory()) return [relative];
  return readdirSync(url).flatMap(name => listFiles(`${relative}/${name}`));
};

const manifestText = readIfPresent("conditor.json");
const lockText = readIfPresent(".conditor/lock.json");
const recordTexts = Object.fromEntries(
  [...Object.values(installationRecordPaths), ".echelon/toolchain.json"].map(path => [path, readIfPresent(path)]));
const generatedTexts = Object.fromEntries(
  [".conditor", ".echelon", ".ros", ".sde", "ros.json", "AGENTS.md", ".gitignore"]
    .flatMap(listFiles)
    .map(path => [path, read(path)]));

const expectFailure = (result, pattern) => {
  assert.equal(result.ok, false, "expected the check to reject the mutated state");
  assert.match(result.error, pattern);
};

const withLock = mutate => {
  const lock = JSON.parse(lockText);
  mutate(lock);
  return lock;
};

test("committed Conditor lock exists and binds the committed manifest", () => {
  assert.ok(lockText, ".conditor/lock.json must be committed (generated by conditor init)");
  const result = checkLockBindsManifest(manifestText, lockText);
  assert.ok(result.ok, result.error);
  assert.equal(result.value.lock.schemaVersion, 4);
});

test("lock binding rejects a missing lock, a changed manifest and a rewritten declaration", () => {
  const asText = lock => JSON.stringify(lock, null, 2);
  expectFailure(checkLockBindsManifest(manifestText, undefined), /lock\.json is missing/);
  expectFailure(checkLockBindsManifest(undefined, lockText), /conditor\.json is missing/);
  expectFailure(checkLockBindsManifest(manifestText.replace('"3.7.2"', '"3.7.1"'), lockText), /manifestSha256/);
  expectFailure(checkLockBindsManifest(manifestText + "\n", lockText), /manifestSha256/);
  expectFailure(checkLockBindsManifest(manifestText, asText(withLock(l => { l.manifest.components[0].version = "3.7.1"; }))), /lock\.manifest differs/);
  expectFailure(checkLockBindsManifest(manifestText, asText(withLock(l => { l.project = "other"; }))), /lock project/);
  expectFailure(checkLockBindsManifest(manifestText, "{not json"), /not valid JSON/);
});

test("lock records every declared component at its declared version with immutable authority", () => {
  const bound = checkLockBindsManifest(manifestText, lockText);
  assert.ok(bound.ok, bound.error);
  const result = checkLockComponents(bound.value.manifest, bound.value.lock);
  assert.ok(result.ok, result.error);
  assert.deepEqual(
    result.value.map(c => [c.id, c.version]),
    bound.value.manifest.components.map(c => [c.id, c.version]));
});

test("lock component check rejects drifted, missing, extra and unpinned entries", () => {
  const declared = JSON.parse(manifestText);
  const indexOf = id => JSON.parse(lockText).components.findIndex(c => c.id === id);
  const check = mutate => checkLockComponents(declared, withLock(mutate));
  expectFailure(check(l => { l.components[indexOf("ordo")].version = "1.4.2"; }), /'ordo' locked at 1\.4\.2 but declared 1\.5\.0/);
  expectFailure(check(l => { l.components = l.components.filter(c => c.id !== "praxis"); }), /declared component 'praxis' is not locked/);
  expectFailure(check(l => { l.components.push({ ...l.components[0], id: "forma" }); }), /'forma' is not declared/);
  expectFailure(check(l => { l.components.push(l.components[0]); }), /more than once/);
  expectFailure(check(l => { l.components[indexOf("praxis")].descriptorSha256 = "deadbeef"; }), /'praxis' lacks a sha256 descriptor digest/);
  expectFailure(check(l => { delete l.components[indexOf("praxis")].sourceReference; }), /'praxis' lacks a source reference/);
  expectFailure(check(l => { l.components[indexOf("visual-engineering")].sourceReference = "@echelon-foundry/visual-engineering@latest"; }), /not pinned to 1\.0\.1/);
  expectFailure(check(l => { l.components[indexOf("communication-engineering")].sourceReference = "github:kemiller2002/communication-engineering#main|node:bin/x.mjs"; }), /not pinned to a full commit/);
  const redeclared = { ...declared, components: declared.components.map(c => (c.id === "praxis" ? { ...c, version: "3.7.1" } : c)) };
  expectFailure(checkLockComponents(redeclared, JSON.parse(lockText)), /'praxis' locked at 3\.7\.2 but declared 3\.7\.1/);
});

test("component installation records and toolchain pins agree with conditor.json", () => {
  const result = checkInstallationRecords(JSON.parse(manifestText), recordTexts);
  assert.ok(result.ok, result.error);
});

test("installation record check rejects missing records and disagreeing versions", () => {
  const declared = JSON.parse(manifestText);
  const replace = (path, from, to) => {
    assert.ok(recordTexts[path].includes(from), `fixture precondition: ${path} contains ${from}`);
    return { ...recordTexts, [path]: recordTexts[path].replace(from, to) };
  };
  expectFailure(checkInstallationRecords(declared, { ...recordTexts, ".echelon/sde.json": undefined }), /sde\.json is missing/);
  expectFailure(checkInstallationRecords(declared, replace(".echelon/ros.json", '"installedVersion": "3.7.2"', '"installedVersion": "3.7.1"')), /ros\.json reports 3\.7\.1/);
  expectFailure(checkInstallationRecords(declared, replace(".echelon/toolchain.json", '"ordo": "1.5.0"', '"ordo": "1.4.2"')), /pins ordo 1\.4\.2/);
  const extended = { ...declared, components: [...declared.components, { id: "unknown-tool", version: "1.0.0", required: true }] };
  expectFailure(checkInstallationRecords(extended, recordTexts), /unknown-tool/);
});

test("generated lifecycle state carries no local absolute paths or credentials", () => {
  assert.ok(Object.keys(generatedTexts).length > 20, "generated lifecycle state appears to be missing");
  const result = checkNoLocalLeaks(generatedTexts);
  assert.ok(result.ok, result.error);
  expectFailure(checkNoLocalLeaks({ "x.json": '{"root":"/tmp/claude/scratch/vitium"}' }), /x\.json contains an absolute \/tmp path/);
  expectFailure(checkNoLocalLeaks({ "y.json": '{"root":"/home/runner/work/vitium"}' }), /absolute \/home path/);
  expectFailure(checkNoLocalLeaks({ "z.md": "token ghp_" + "a".repeat(36) }), /GitHub token/);
});
