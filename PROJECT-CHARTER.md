# Vitium project charter

**Product:** Vitium, the Echelon Foundry defect reporting, investigation and learning system.

## Problem

Echelon software has quality findings distributed across repositories. Ordinary users cannot reliably report problems without knowing GitHub conventions, and agent repairs can regress without a shared defect/evidence lifecycle.

## Intended outcomes

1. Accessible reporting by customers and maintainers with minimal technical terminology.
2. Reliable traceability from original observation through triage, implementation, independently verified fix and regression prevention.
3. Cross-repository evidence correlation and feedback into Dokimos, Praxis and Ordo.
4. A provider-neutral internal defect contract, with Arca persistence and Fides for internal access when available.

## Current boundary

The first committed slice is a **public reporting form that hands off to GitHub Issues**. It does not take private submissions, create issues directly, store data, authenticate reporters, support attachments, deploy a back end, or prove regression intelligence.

## Product rules

- The human reporter describes symptoms, not root cause or engineering priority.
- Severity, priority, root cause and accepted verification are determined during engineering triage.
- Keep user-facing reports distinct from internal implementation issues, while preserving traceability.
- A public issue must never expose a private repository, internal token or customer data.
- Never claim submission or persistence without an acknowledged server-side outcome.
- Every fix must have independently checkable evidence, preferably a test that fails against the faulty behavior.
- GitHub is an initial persistence/provider boundary, not the permanent public identity or storage model.

## Product requirements and accepted authority

The expanded product baseline is currently **proposed** at `docs/requirements/VITIUM-REQUIREMENTS.md`. Its matching executable acceptance design is `docs/requirements/VITIUM-ACCEPTANCE.md` and unsettled product/architecture choices are `docs/requirements/VITIUM-OPEN-DECISIONS.md`. Neither these documents nor the static reporter constitute an approved production launch.

Vitium's current roadmap epics are GitHub issues #1–#13. Keep observation intake, confirmed defect state, engineering work authority and independently verified result as separate entities.
