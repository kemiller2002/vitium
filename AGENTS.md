# Vitium agent operating rules

## Authority and bootstrap

1. Follow explicit user decisions, applicable safety constraints, installed Conditor/Praxis/Ordo governance, canonical project requirements and accepted decision records, in that order.
2. Read `docs/GOVERNANCE.md` and `conditor.json` before substantial changes. Conditor owns lifecycle installation, verification and upgrades. Never forge its lock, installation receipts, provenance or tool-generated files.
3. The canonical public domain is **https://vitium.echelonfoundry.com/**. Do not substitute the old github.io address in UI or canonical metadata.
4. After a verified Conditor install, execute work through the generated Praxis/Ordo protocols, with real identities, work items, evidence, durable checkpoints and verification. Until then, mark governance as incomplete rather than simulating success.
5. Never claim a deployment, a CI check, an installation, a browser test or a DNS validation passed without witnessing it.

## Requirements authority

The canonical proposed product scope is `docs/requirements/VITIUM-REQUIREMENTS.md`; acceptance cases are in `docs/requirements/VITIUM-ACCEPTANCE.md`; pending decisions are in `docs/requirements/VITIUM-OPEN-DECISIONS.md`. Read these before planning substantive behavior. Proposed requirements are not implementation evidence or decision approval. Reference individual requirement IDs in work items and change reviews, and keep questions unresolved rather than inventing answers.

## Initial application rules

1. Read `PROJECT-CHARTER.md`, `context/CURRENT-STATE.md`, `docs/REPORTING.md`, and `schemas/defect.schema.json` before editing.
2. Keep requirements, current state, and implemented behavior aligned. Do not claim the direct intake API or Fides/Arca integration is finished when it isn't.
3. Use **Forma** for presentation and native semantic elements for inputs; do not fork shared CSS. Interaction is Vitium-owned until the Limen integration is implemented.
4. Treat all reporter content as untrusted. Never interpolate into HTML, run reproduction code, put private data into URLs or ship secrets to the browser.
5. A human must explicitly submit the GitHub Issue in the current flow. Do not pretend the Review or Continue action has created an issue.
6. Preserve minimal public fields: application, impact, summary, actual/expected behavior, optional repro steps and optional sanitized page URL.
7. Introduce server-mediated, moderated public intake before attempting GitHub-free submissions, attachments or private storage.
8. Every implementation change needs valuable tests and evidence. Test plausible broken implementations, not only happy-path fixture data.
9. Keep source-specific adapters behind stable ports; minimize dependencies and avoid shortcuts that compromise provider independence.
10. Provide keyboard- and machine-operable interfaces with stable IDs/labels and visible focus. Never use styling alone to communicate error or progress.

## Private intake rules

- `service/report-domain.mjs` is the candidate public report validation contract; `site/submission.mjs` is the legacy GitHub handoff contract. Keep product and impact lists aligned and pass negative consistency tests.
- `service/intake.mjs` has an explicit store and challenge verifier effect boundary. Persist private **observations** only after verified challenge; never call reports confirmed defects automatically.
- The AWS Lambda adapter is a staging candidate, not the Echelon-qualified F#/Limen final implementation. It uses the runtime-included AWS SDK and is not released through a pinned supply-chain contract; this is an explicit unresolved architectural deviation.
- The IAM operator CLI is for protected environments only; never expose the raw reporting table through public API endpoints.
- `site/public-config.mjs` MUST remain disabled until operator approval, data policy, custom API domain, real backend integration and end-to-end proof.
- Read `docs/P0-IMPLEMENTATION.md` and `infra/aws/README.md` before changing P0 service code.

## Current checks

`npm test` executes node-native submission contract tests. A full real-browser and accessibility suite is not yet installed; track it in issue #2.

<!-- BEGIN echelon:visual-engineering -->
## Visual Engineering UI research

Managed by `npx @echelon-foundry/visual-engineering`. Do not edit inside this block.

Before designing, implementing, or reviewing UI:

1. Run `npx @echelon-foundry/visual-engineering verify` and stop if it reports a failure.
2. Read `.visual-engineering/AGENT-INSTRUCTIONS.md`.
3. Read `.visual-engineering/UI-FOUNDATIONS.md`.
4. Read `.visual-engineering/UI-DECISION-CHECKLIST.md`.
5. Read `.visual-engineering/UI-ANTI-PATTERNS.md`.
6. Consult `.visual-engineering/RESEARCH-INDEX.md` for provenance and deeper evidence.
7. Inspect the product and its existing design system.
8. Apply the research as decision criteria, not as a visual style.
9. Report the context version, source commit, principles applied, verification
   performed, and justified deviations.

Do not copy Visual Engineering research into this repository by hand.
<!-- END echelon:visual-engineering -->

<!-- echelon:communication-engineering:start -->
## Communication Engineering

Communication Engineering is installed as evidence-bounded operational guidance.
Before producing consequential communication, read:

- `.communication-engineering/COMMUNICATION-FOUNDATIONS.md`
- `.communication-engineering/COMMUNICATION-DECISION-CHECKLIST.md`
- `.communication-engineering/PURPOSE-OUTCOME-MATRIX.md`
- `.communication-engineering/COMMUNICATION-ANTI-PATTERNS.md`
- `.communication-engineering/RESEARCH-STATUS.md`

Treat research maturity as a constraint. Do not turn provisional findings into universal rules, optimize persuasion at the expense of user autonomy, or substitute style for proof obligations.
<!-- echelon:communication-engineering:end -->
