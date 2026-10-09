---
id: DF-GOV-2026-C0E6
title: Conditor lifecycle installation and committed-state CI verification for Vitium
status: review
version: 1.0.0
owners:
  - repository-governance
created: 2026-10-08
updated: 2026-10-08
author_agent: claude-code (claude-opus-5-5)
supporting_evidence: []
related_documents:
  - conditor.json
  - .conditor/lock.json
  - docs/GOVERNANCE.md
  - .github/workflows/conditor-governance.yml
  - docs/agent-scripts/CLAUDE-VITIUM-P0.md
supersedes: []
superseded_by: []
tags: [governance, conditor, praxis, ordo, ci, p0]
confidence: medium-high
provenance:
  contributions:
    EXE-20261008T125753191Z-b0366397:
      operations: [created]
      at: 2026-10-08T13:08:35.000Z
      actor:
        kind: agent
        id: claude-code
        provider: anthropic
        model: claude-opus-5-5
        runtime: claude-code
      reason: "Records the Conditor installation and CI verification decision for VIT-P0-GOV-001"
      evidence: [.conditor/lock.json, .github/workflows/conditor-governance.yml]
---

# Context

Mission VIT-P0-2026-10-08 Phase B requires a genuine Conditor installation,
not a preview. Before this decision, `conditor.json` declared Praxis 3.7.2,
Ordo 1.5.0, Visual Engineering 1.0.1 and Communication Engineering 1.0.0. An
isolated CI preview (run 37772428835) had installed them without committing
the result. Praxis work item: `VIT-P0-GOV-001`.

# Decision

1. Commit the real output of `conditor init --target . --manifest ./conditor.json`
   (Conditor v0.5.0), unchanged, plus the output of a second identical `init`.
   That second run only re-records Praxis' shared-file fingerprints in
   `.echelon/ros.json`. A third `init` produces no diff.
2. Verify the committed state in CI on every push and pull request
   (`.github/workflows/conditor-governance.yml`). CI installs Conditor, Praxis
   and Ordo after checking their sha256 sums and GitHub attestations. It then
   runs `conditor verify`, `conditor doctor --json`, `conditor status --json`
   (both must report `healthy: true`), `praxis verify --strict` and
   `ordo verify --integrity-only --json`, and fails if any of them changes the
   tree. CI never runs `init`, `repair` or `upgrade`.
3. `node --test tests/governance.test.mjs` also checks that the lock is bound
   to `conditor.json` (the sha256 of the manifest bytes and the recorded
   declaration). It checks that each declared component is locked exactly once,
   at the declared version, with a descriptor digest and an immutable source.
   It also checks that the per-component installation records and
   `.echelon/toolchain.json` agree with the manifest.
4. `execution.enabled` stays `false`. The mission documents do not authorize
   Conditor-launched agent execution, so enabling it needs an integrator
   decision.
5. The `fsharp-limen-web` scaffold is **not** applied. `conditor plan` refuses
   because `package.json` and `DEPLOYMENT.md` already exist. A later bounded
   mission should handle the migration (see the "Scaffold migration
   recommendation" section of `docs/GOVERNANCE.md`).

# Observations that shaped the decision

- Praxis takes the project name from the target directory's basename. A run
  from a checkout directory with a different name, such as an agent worktree,
  would record the wrong project name. The committed state was produced from
  a directory named `vitium`, which matches a GitHub Actions checkout.
- `conditor verify` does not compare `conditor.json` with the lock, and a
  missing lock does not make it fail. `conditor doctor`/`status` do detect a
  missing lock, a changed manifest and changed component identities (observed
  exit codes 12 and 7). CI therefore requires their `healthy` flag as well.
- Local installation was only checked against sha256 sums, because Sigstore is
  blocked in the authoring sandbox. CI keeps `gh attestation verify` for all
  three tools.
- `conditor upgrade --check` refuses scaffold changes ("Upgrade changes
  unsupported governing fields: scaffold").

# Consequences

- A change to managed or tool-owned files, the lock or the manifest is
  rejected unless it was made through Conditor or the owning tool.
- Edits to Vitium's own text outside the tool-managed regions of `AGENTS.md`
  and `.gitignore` still pass `verify`, because those files are shared or
  user-owned. A later `conditor init` re-records their fingerprints in
  `.echelon/ros.json`, and that diff must be committed.
- The Praxis-generated `praxis-validation.yml` workflow now enforces
  work-item attribution (`./praxis validate`). New meaningful changes need an
  active or completed Praxis work item.
