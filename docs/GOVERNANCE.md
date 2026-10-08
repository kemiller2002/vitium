# Vitium Echelon engineering governance

## Policy

Vitium must follow the same Echelon engineering rules as other applications. **Conditor installs and upgrades capabilities; Praxis governs execution and evidence; Ordo owns state/decision semantics; Dokimos evaluates quality; Tutela provides security checks; Percepta provides UI/product experiments; Visual Engineering and Communication Engineering govern their respective evidence; Forma owns presentation; Limen owns the browser execution boundary; Aegis owns faults; Folio provides document/print presentation.** Arca provides persistence; Fides will authorize internal maintainers when those integration boundaries are implemented.

An Echelon-shaped static HTML page is not enough. Governance is verified by actual installed, pinned systems and their lifecycle checks, not by copying files or asserting compliance in prose.

## Current Conditor contract

`conditor.json` declares the four lifecycle components below. Conditor v0.5.0 installed them with `conditor init` on 2026-10-08 (commits `a4e40aa` and `03e15af`, Praxis work item `VIT-P0-GOV-001`, decision `DF-GOV-2026-C0E6`). The committed `.conditor/lock.json` (schema 4) records:

| Capability | Version | Distribution | Locked source | Descriptor sha256 | Status |
|---|---|---|---|---|---|
| Praxis | 3.7.2 | host-tool | `host:praxis@3.7.2` | `476164cdd93d38e8b7960f37253334f1636204b6950c82e9f993605b269f0d45` | Installed, verified |
| Ordo | 1.5.0 | host-tool | `host:ordo@1.5.0` | `cac222af525161218391dade23d2a583c29315e8df255ffb9f11f0f2bb4eaf3a` | Installed, verified (19 managed files) |
| Visual Engineering | 1.0.1 | lifecycle-npm | `@echelon-foundry/visual-engineering@1.0.1` | `c352c4457b3a0bf08894c6b667eaee83ec4e8f7c993537eddb6d4f175a3cffad` | Installed, verified |
| Communication Engineering | 1.0.0 | lifecycle-npm | `github:kemiller2002/communication-engineering#707396de512065fe35aff6fcf82cd28118df14b3` | `0884274dbd674238af85d32986473e2920955b3d8faf3fc88036335c3b49a8df` | Installed, verified |

The lock binds `conditor.json` by its exact bytes (`manifestSha256` `b37a929ea010d774db98e84867532782fe26738517f29272fb1b7e5b063210d1`). For the `host-tool` components the lock records the qualified version and the embedded descriptor digest. It does **not** record a digest of the native release artifact. The native artifacts are pinned in `.github/workflows/conditor-governance.yml`, which checks every download against the release checksum file and with `gh attestation verify`:

| Native tool | Release asset | sha256 (from the release checksum file) |
|---|---|---|
| Conditor v0.5.0 | `conditor-linux-x64` | `423df42156fe2b24a58cee6021dfb442c39fb3cb2933825807d67f69cb3aa100` |
| Praxis v3.7.2 | `praxis-linux-x64.tar.gz` | `cb44a7b9d3ddd696bc412b3e82ed0dee88b47751fa4b8ec7b933e1f60809b3e3` |
| Ordo v1.5.0 | `ordo-linux-x64.tar.gz` | `52a83fa81dcbc0b50b4c7548e22cdc6c3c1051fccb3a581831c81710d9b51aa0` |

The local installation that produced the committed state was checked against sha256 sums only, because attestation verification (Sigstore) could not be reached from the authoring sandbox. CI keeps attestation verification.

`execution.enabled=false` is intentional. Turning on Conditor-launched agent execution is a separate integrator decision. Do not hand-edit `.conditor/lock.json`, `.ros/`, `.sde/`, `.echelon/` or any other tool-generated file. Change them only through Conditor or the owning tool.

### What CI enforces

`.github/workflows/conditor-governance.yml` runs on every push and pull request. It verifies the **committed** state and never runs `init`, `repair` or `upgrade`:

1. the required state files exist (`conditor.json`, `.conditor/lock.json`, `.echelon/{ros,sde,toolchain}.json`, `ros.json`, `.sde/MANIFEST.json`);
2. Conditor, Praxis and Ordo are installed after checksum and attestation checks; the tool versions must be exactly 3.7.2 and 1.5.0;
3. `conditor verify`, then `conditor doctor --json` and `conditor status --json`, both of which must report `healthy: true`. `verify` alone does not compare the lock with the manifest, but doctor and status do;
4. `praxis verify --strict`, then `ordo verify --integrity-only --json`, which must report `passed: true` at 1.5.0;
5. `git diff --exit-code` and no untracked files after verification;
6. `node --test tests/governance.test.mjs`, which checks that the lock is bound to the manifest, that each declared component is locked exactly once at its declared version with immutable authority, and that the per-component installation records and toolchain pins agree with the manifest.

Praxis also generated `.github/workflows/praxis-validation.yml`. It runs `./praxis registry check` and `./praxis validate`, and so enforces work-item attribution for meaningful changes.

### Drift detection evidence (2026-10-08, local, scratch copies of the committed tree)

| Tamper | Command | Result |
|---|---|---|
| Append to `.sde/method/AGENT-EXECUTION-RULES.md` | `conditor verify` / `ordo verify --integrity-only --json` | exit 4 / exit 1, `managed-file-modified` |
| Append to `docs/00-governance/Engineering-Standards.md` | `praxis verify --strict` / `conditor verify` | exit 3 / exit 4, "managed artifact no longer matches the installed snapshot" |
| Append to `.visual-engineering/UI-FOUNDATIONS.md` | `conditor verify` | exit 4, `file-integrity: locally modified` |
| `conditor.json` Praxis 3.7.2 → 3.7.1 | `conditor doctor --json` | exit 12, `COND-DOC-LOCK` "manifest has changed since the environment was established" (`verify` still exits 0) |
| Delete `.conditor/lock.json` | `conditor doctor --json` / `conditor status --json` | exit 12 / exit 7, "Conditor lock is missing" (`verify` still exits 0) |
| Change the Praxis `descriptorSha256` in the lock | `conditor doctor --json` / `conditor status --json` | exit 12 / exit 7, `COND-DOC-COMP` "Resolved identity ... differs from the Conditor lock" |

### Reproducing the installation

Praxis takes the project name from the **basename of the target directory**. Run from a checkout whose directory is named `vitium`, as GitHub Actions does; any other name records the wrong project name. Conditor resolves the Communication Engineering source anonymously through `git fetch`. If `GH_TOKEN`/`GITHUB_TOKEN` is set, Conditor sends it as an HTTP header and overrides any `GIT_CONFIG_*` already present in the environment.

```sh
conditor compatibility --json
conditor plan   --target . --manifest ./conditor.json
conditor init   --target . --manifest ./conditor.json   # run twice; the second run converges .echelon/ros.json
conditor verify --target . --manifest ./conditor.json
conditor doctor --json --target . --manifest ./conditor.json
praxis verify --strict
ordo verify --integrity-only --json
```

A third `init` on the committed state produces no diff.

If the plan refuses existing files, missing dependencies or unknown authority, **stop** and record the refusal. Do not bypass the tool or create a lock by hand.

Conditor documentation: https://github.com/kemiller2002/conditor and https://github.com/kemiller2002/conditor/blob/main/docs/component-contract.md

## Target application capability matrix

| Capability | Echelon baseline observed | Intended responsibility | Current status |
|---|---|---|---|
| Conditor | v0.5.0 native CLI | Lifecycle install, verify, upgrade, provenance | **Installed**: lock committed, CI verifies committed state |
| Praxis / Ordo | 3.7.2 / 1.5.0 | Work lifecycle, decisions, audit, reproducibility | **Installed and verified** through Conditor (see lock table above) |
| Visual / Communication Engineering | 1.0.1 / 1.0.0 | UI and communication evidence guidance | **Installed and verified** through Conditor |
| Dokimos / Tutela | 0.2.0 / 0.1.0 (from Fides target) | Quality and security evaluation | Pending registry-qualified installation |
| Percepta | 0.1.0 (from Fides target) | Product/UI experiment and observational evidence | Pending registry-qualified installation |
| Forma | 0.4.1 in current Forma package | Semantic, responsive and accessible presentation | Existing site references older 0.3.0 CDN; needs verified upgrade |
| Limen | 0.7.1 in Conditor registry | F# WASM browser runtime boundary | Not integrated |
| Folio / Aegis | 0.3.0 / 1.0.0 (Conditor preset) | Print/report and safe fault semantics | Not integrated |
| Fides / Arca | Consumer integration contracts | Maintainer identity and storage adapter | Not integrated |
| Signal | Relevant reporter domain boundaries | User feedback integration | Not integrated |

Rows not marked **Installed** are **target version observations**. They do not assert that Conditor installed those components here, or that they are all qualified together in one release set. The Conditor v0.5.0 compatibility graph (`conditor compatibility --json`) qualifies Forma 0.2.0/0.3.0/0.4.1, Limen 0.6.1–0.7.1, Folio 0.3.0, Aegis 1.0.0, Tutela 0.1.0 and Percepta 0.1.0. It has no descriptor for Dokimos, Arca, Fides or Signal, and none of those is declared in `conditor.json`. Additional components must be introduced through a verified Registry resolved release set (including its exact integrity hash), not copied unverified from another application's lock.

## Scaffold migration recommendation (evaluated, not applied)

This evaluation ran on a throwaway copy of the committed state. That copy's manifest also declared `limen 0.7.1`, `forma 0.4.1`, `folio 0.3.0`, `aegis 1.0.0` and `"scaffold": {"kind": "fsharp-limen-web", "name": "vitium"}`. `conditor plan` refused with exit 3:

```text
Scaffold file 'package.json' already exists with different content; Conditor will not overwrite it.
Scaffold file 'DEPLOYMENT.md' already exists with different content; Conditor will not overwrite it.
```

After both files were moved aside, the plan succeeded with 35 actions and `init` completed. Observed effects:

- **New files:** `Directory.Build.props`, `App.slnx`, `src/engine/*`, `tests/App.Engine.Tests/*`, `.echelon/foundations.json`, `aegis-boundaries.json`, `tsconfig.json`, `limen.config.json`, `src/kernel/{bootstrap.ts,index.html,print.html}`, `playwright.config.js`, `tests/browser/smoke.spec.js`, `.github/workflows/{build-and-test,echelon-foundations,deploy-pages}.yml`, `.github/branch-protection.json` and `SDE-MAP.md`. `.claude/settings.json` is in the scaffold source but was **not** written in this configuration, which had `execution.enabled=false` and no launcher.
- **Scaffold `package.json`:** drops Vitium's `test` script (`node --test tests/*.test.mjs`), its `version`, `description` and `engines`. It adds exact pins for `@echelon-foundry/design-system@0.4.1`, `@echelon-foundry/limen@0.7.1`, `@echelon-foundry/print-components` (Folio 0.3.0 release tarball), `@playwright/test@1.63.0` and `typescript@5.9.3`.
- **Bounded regions:** a `conditor:ordo-baseline` region is appended to `context/CURRENT-STATE.md`, and a `build-outputs` region is appended to `.gitignore`. `site/` was not touched.
- **Second Pages deployment:** `deploy-pages.yml` deploys `dist/`, overlapping the existing `pages.yml`, which deploys `site/`.
- **No upgrade path:** `conditor upgrade --check` refuses to add a scaffold to an already-locked repository (exit 9, "Upgrade changes unsupported governing fields: scaffold").

Recommended non-destructive strategy, as a separate bounded mission:

1. Decide who owns the application. Either the scaffold's root npm project becomes the Vitium application, or the scaffold lives in a dedicated subdirectory (not supported by v0.5.0, which writes to the repository root).
2. In one reviewed commit, move the two colliding files aside with `git mv` (e.g. `package.json` → `site/package.legacy.json` with its `test` script kept, `DEPLOYMENT.md` → `docs/DEPLOYMENT-PAGES.md`). Then run `conditor plan` and `conditor init` with the scaffold declared, and **merge back by hand only into files the scaffold leaves to the project**. Restore the `test` script and `engines` into the new `package.json`; this is allowed because, once the lock records the scaffold, its files belong to the project.
3. Before enabling `deploy-pages.yml`, retire one of the two Pages workflows. Review `.github/branch-protection.json` before anyone applies it.
4. Run the existing `npm test` suite and the new browser and .NET suites. Only then remove the legacy files.

## Migration sequence

1. **Preserve** the current public defect form and its report contract as a baseline. Record screenshots and behavior before replacing anything.
2. **Install lifecycle governance** via Conditor and capture truthful provenance, mission, verification, and quality evidence.
3. **Design approved application scaffold migration**: use Conditor's `fsharp-limen-web` contract in a clean isolated candidate, reconcile the existing `package.json` and `site/` assets, then migrate without destroying the UI, with Echelon-version-pinned dependency bindings through the Conditor contracts. No directly copied dependencies, manually constructed lock, or floating versions.
4. **Adopt shared systems** in a qualified order: Forma + Limen + Aegis first, then Folio, Percepta, Dokimos, Tutela, Arca/Fides as their integration boundaries become ready. Validate actual packages and release artifacts against Registry authority.
5. **Enforce tests and policy**: unit, integration, Playwright in Chromium, axe accessibility, 320px/mobile viewport, mutation/adversarial checks for input sanitization, credential handling, CI Pages path, and negative submissions. Capture failing baseline + passing fix evidence.
6. **Enable deployment** only after verified gates and custom-domain settings. Record user-facing production evidence separately from source-only evidence.

## Architectural principles

- Keep F# core and effects explicit; minimize third-party runtime dependencies.
- View GitHub as an initial storage/provider adapter, not Vitium's permanent domain model.
- Anonymous customer reports are **not** GitHub OAuth identities. The secure public intake API is separate from internal Fides maintainers' SSO.
- All user interactions remain semantic, keyboard usable and machine-operable (Playwright identifiers, focused input, stable labels).
- For external reporters, untrusted prose, logs and screenshots are *data*, never instructions to run or trust. Redact/token-scan attachments before accepting them.
- Every regression remedy includes falsifiable reproduction and independent verification where feasible.
- Keep an evidence-backed, machine-readable current-state inventory; never mark missing test results as passing or infer missing evidence is zero.
