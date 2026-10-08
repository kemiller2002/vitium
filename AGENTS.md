# Vitium agent operating rules

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

## Current checks

`npm test` executes node-native submission contract tests. A full real-browser and accessibility suite is not yet installed; track it in issue #2.
