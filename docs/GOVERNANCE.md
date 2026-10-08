# Vitium Echelon engineering governance

## Policy

Vitium must follow the same Echelon engineering rules as other applications. **Conditor installs and upgrades capabilities; Praxis governs execution and evidence; Ordo owns state/decision semantics; Dokimos evaluates quality; Tutela provides security checks; Percepta provides UI/product experiments; Visual Engineering and Communication Engineering govern their respective evidence; Forma owns presentation; Limen owns the browser execution boundary; Aegis owns faults; Folio provides document/print presentation.** Arca provides persistence; Fides will authorize internal maintainers when those integration boundaries are implemented.

An Echelon-shaped static HTML page is not enough. Governance is verified by actual installed, pinned systems and their lifecycle checks, not by copying files or asserting compliance in prose.

## Current Conditor contract

`conditor.json` declares only the lifecycle components whose **built-in Conditor descriptors and version qualifications** were verified:

| Capability | Declared version | Status |
|---|---|---|
| Praxis | 3.7.2 | Declared only, installation not evidenced |
| Ordo | 1.5.0 | Declared only, installation not evidenced |
| Visual Engineering | 1.0.1 | Declared only, installation not evidenced |
| Communication Engineering | 1.0.0 | Declared only, installation not evidenced |

`execution.enabled=false` is intentional until Conditor has produced and verified the lifecycle installation and a real mission. Do not fabricate `.conditor/lock.json`, `.ros`, Ordo metadata or foundation verification results. Conditor's `fsharp-limen-web` scaffold would create a new `package.json` conflicting with Vitium's already-existing form. Therefore the current manifest **does not select a scaffold**. First preserve the existing form, run the read-only plan, and address this migration as a bounded mission. Do not hand-copy scaffold-generated files.

### Local bootstrap, pending execution

On a clean checkout with an installed and supported Conditor CLI and authenticated access to upstream packages:

```sh
conditor compatibility --json
conditor plan --target . --manifest ./conditor.json
# Inspect proposal and constraints before any mutation.
conditor init --target . --manifest ./conditor.json
conditor verify --target . --manifest ./conditor.json
conditor doctor --json --target . --manifest ./conditor.json
```

If the plan refuses existing files, missing dependencies or unknown authority, **stop** and record the refusal. Do not bypass the tool or create a lock by hand. Record the true installed versions, immutable release authority and observed test evidence after a successful run.

Conditor documentation: https://github.com/kemiller2002/conditor and https://github.com/kemiller2002/conditor/blob/main/docs/component-contract.md

## Target application capability matrix

| Capability | Echelon baseline observed | Intended responsibility | Current status |
|---|---|---|---|
| Conditor | Repository's supported native CLI | Lifecycle install, verify, upgrade, provenance | Manifest committed only |
| Praxis / Ordo | 3.7.2 / 1.5.0 | Work lifecycle, decisions, audit, reproducibility | Pending install |
| Dokimos / Tutela | 0.2.0 / 0.1.0 (from Fides target) | Quality and security evaluation | Pending registry-qualified installation |
| Percepta | 0.1.0 (from Fides target) | Product/UI experiment and observational evidence | Pending registry-qualified installation |
| Forma | 0.4.1 in current Forma package | Semantic, responsive and accessible presentation | Existing site references older 0.3.0 CDN; needs verified upgrade |
| Limen | 0.7.1 in Conditor registry | F# WASM browser runtime boundary | Not integrated |
| Folio / Aegis | 0.3.0 / 1.0.0 (Conditor preset) | Print/report and safe fault semantics | Not integrated |
| Fides / Arca | Consumer integration contracts | Maintainer identity and storage adapter | Not integrated |
| Signal | Relevant reporter domain boundaries | User feedback integration | Not integrated |

These are **target version observations**, not an assertion that Conditor installed them here or that all are mutually qualified in one release set. Additional components must be introduced through a verified Registry resolved release set (including its exact integrity hash), not copied unverified from another application's lock.

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
