---
id: VIT-DECISIONS
title: Vitium decisions requiring product or architectural authority
status: open
version: 0.1.0
created: 2026-10-08
owner: vitium
---

# Open decisions and recommended defaults

These are open architectural/product decisions. Recommendations below are **proposals**, not settled user decisions. Do not silently interpret an unresolved row as permission to deploy, collect user data or claim a service-level commitment. Each resolution should be captured in an Ordo-approved decision record with alternatives, implications, verification and migration notes.

| ID | Open question | Recommended provisional approach | Needed before |
|---|---|---|---|
| VIT-OQ-001 | Is Vitium only for Echelon products, or a sellable multi-organization service? | Begin with an Echelon-only tenant boundary and typed future tenant identity; do **not** silently expose data across products or customers. | Internal schema, permission model, API |
| VIT-OQ-002 | Is GitHub Issues or Vitium/Arca the canonical defect record? | Vitium owns reports, defect state and evidence; GitHub owns product-specific implementation work items; synchronize by immutable IDs. Legacy public GitHub reports require explicit migration/retention policy. | Persistence and sync |
| VIT-OQ-003 | Where does the public submission API execute? | Cloud-neutral F# core plus thin AWS-first HTTP/queue adapter; GitHub Pages remains static site only. No Kubernetes. | Anonymous intake |
| VIT-OQ-004 | What private storage backs anonymous receipt durability? | Choose service-backed durable queue/store for protected intake; use Arca as data port only after operational guarantees, rate limits and permissions are proven. Never write directly from the public browser into a private GitHub repo. | Anonymous intake |
| VIT-OQ-005 | What may anonymous users learn about defect status? | Give receipt for submission and a distinct, high-entropy, revocable status capability; offer only broad, safe status and no confidential issue links. Receipt itself is not an auth token. | Public status |
| VIT-OQ-006 | How are follow-ups and contact handled? | Optional, verified contact; separate consent for replies/notifications; provide no guaranteed reply until support capacity and policy are established. | Notification delivery |
| VIT-OQ-007 | Should public issues remain enabled? | Treat as legacy, non-sensitive, GitHub-authenticated reporting path with prominent warning until secure direct intake replaces it; do not auto-mirror all reports publicly. | Public launch |
| VIT-OQ-008 | Who administers triage, abuse handling, vulnerabilities and retention? | Name one designated operator and escalation backup, define review intervals and on-call expectations before collecting customer reports. | Production data |
| VIT-OQ-009 | What are retention/deletion periods and data locations? | No number yet. Select a published policy based on support needs and legal requirements; include GitHub mirrors, logs, screenshots and backups. | Production data |
| VIT-OQ-010 | How will secure attachments work? | Defer until scanning, redaction, type caps, access, deletion, malware response and storage choice approved. | Attachments |
| VIT-OQ-011 | Which defect states are canonical? | Preserve schema v1 states for compatibility but formally specify guards, special dispositions and separate merged/build/deployed/verified facts. Distinguish report triage from confirmed defect resolution. | Domain implementation |
| VIT-OQ-012 | Who can mark a defect verified? | Independent human or qualified verification agent/process under documented risk policy; do not equate implementation author approval with independent proof. | Resolution |
| VIT-OQ-013 | What creates an automatic defect? | Default automatic integrations to **observations/triage suggestions**, not confirmed defects. Require evidence confidence and explicit policy to promote. | CI/Aegis/agent intake |
| VIT-OQ-014 | How are "duplicate" and "recurrence" decided? | Combine deterministic fingerprints with explainable similarity suggestions; preserve individual reports; require triage review before destructive merges or causal assertions. | Search/correlation |
| VIT-OQ-015 | How much context can integrated applications capture? | Approved product ID, release/version, screen identifier and redacted fault correlation only; no cookies, local storage, PII, raw error stack or screenshots by default. Reporter must be able to review optional additions. | Embedded SDK |
| VIT-OQ-016 | Which analytics should guide engineering decisions? | Start with measured triage lag, verified resolution lag, reopening/recurrence and evidence quality. No numeric goals until service usage provides baseline. | Dashboards |
| VIT-OQ-017 | What is the qualifying Echelon release set for Vitium? | Resolve compatible versioned components through Registry and Conditor; never copy another repo's lock or claim the manifest installs the ecosystem. | Full-stack migration |
| VIT-OQ-018 | What constitutes launch-ready? | Approved P0 requirements and actual security, end-to-end, browser, operations, governance and domain deployment evidence, recorded with immutable references. | Launch |

## Proposed lifecycle semantics

The current \`schemas/defect.schema.json\` models an internal defect with states \`new\`, \`triaged\`, \`reproducing\`, \`confirmed\`, \`in-progress\`, \`awaiting-verification\`, \`resolved\`, \`closed\`, \`duplicate\`, \`not-reproducible\`. This is an initial vocabulary, **not** a verified Ordo transition authority. A report/observation requires an independent intake/triage state so that a false or unverifiable observation need not be promoted to a defect.

**Candidate workflow for design review:**

\`\`\`text
observation: received -> quarantined/review -> accepted-for-triage -> classified
                                 -> rejected (reason required)

defect: new -> triaged -> reproducing -> confirmed -> in-progress
                     \\-> duplicate / not-reproducible (reason required)
                           in-progress -> awaiting-verification
                           awaiting-verification -> in-progress (failed proof)
                           awaiting-verification -> resolved (qualified evidence)
                           resolved -> closed (policy guard)
                           resolved/closed -> reopened (new evidence/occurrence)
\`\`\`

Separate append-only events: fix proposed, code merged, build passed, release published, deployment observed, regression verified, reporter acknowledged, restored/reopened. Dispositions like "expected behavior" or "declined" should be explicit typed outcomes rather than overloaded as "resolved fixed".

Ordo must refine transitions, invariants, required evidence and role guards *before* this candidate becomes executable state machine authority. Forbidden transitions should fail closed.

## Criteria for deciding unresolved rows

- Prefer smallest implementation that preserves truthful evidence and eventual provider neutrality.
- Respect Echelon boundaries: Conditor for lifecycle; Ordo for legal transitions; Praxis for execution; Dokimos for quality; Fides for maintainers; Arca for storage abstraction.
- Maintain clear separation of anonymous public entry, internal issue/defect store, and private repository work.
- Treat retrospective reporting or AI drift diagnosis as evidence-based and falsifiable, not inference from agent identity.
- Do not choose mandatory external identity or collect contact information merely because GitHub is presently the backing provider.
- Record every approved decision as authoritative; leave unapproved features gated instead of hard-coding a guess.

## Outstanding questions that need explicit product direction

1. Whether the product remains Echelon-only or should be structured from day one for external organizations.
2. Whether reporters should be anonymous by default or offered optional sign-in.
3. Whether public issue listings should remain at all once the protected intake endpoint exists.
4. Whether reporter status is necessary for the initial production release or can be follow-up-only.
5. Who serves as intake owner and what retention/response policy should be adopted.

Other details can proceed as reversible engineering design proposals, but their acceptance must still be recorded.
