// Machine verification results may only *propose* a lifecycle transition (VIT-VER-009/011,
// VIT-AC-036). A proposal is applied solely through transition() by an authorized, independent
// verifier, so a green build, an agent's own claim or a forged status cannot close a defect.
import { verificationEventTypes } from "./machine-observation.mjs";
import { latestSubmission, transition } from "./triage.mjs";

const targets = Object.freeze({
  "verification.failed": { to: "in-progress", verificationOutcome: "failed" },
  "verification.passed": { to: "resolved", verificationOutcome: "passed" },
  "verification.inconclusive": { to: "awaiting-verification", verificationOutcome: "inconclusive" }
});
const none = reason => Object.freeze({ proposal: null, reason });

/** Pure: derives a proposal from a stored machine observation item, or explains why none applies. */
export function proposeFromMachineObservation(defect, item) {
  const observation = item?.envelope;
  if (!observation || !verificationEventTypes.includes(observation.eventType)) return none("not-a-verification-result");
  if (!defect || defect.kind !== "defect" || observation.correlation.defectId !== defect.id) return none("defect-mismatch");
  if (defect.state !== "awaiting-verification") return none("defect-not-awaiting-verification");
  const candidate = latestSubmission(defect.history || []);
  if (!candidate || candidate.attemptId !== observation.correlation.verificationAttemptId ||
      candidate.candidateRevision !== observation.subject.commit) {
    return none("stale-or-mismatched-attempt");
  }
  return Object.freeze({
    proposal: Object.freeze({
      ...targets[observation.eventType],
      attemptId: candidate.attemptId,
      candidateRevision: candidate.candidateRevision,
      evidenceId: item.pk,
      workItemId: observation.subject.workItemId,
      proposedBy: item.principal?.subject ?? null,
      provenance: item.provenance ?? null
    }),
    reason: null
  });
}

/** Applies a proposal under a human or independent verifier's own identity; proposal facts cannot be altered. */
export function acceptProposal(defect, proposal, decision, policy) {
  if (!proposal) throw new TypeError("No proposal to accept.");
  const { to, verificationOutcome, attemptId, candidateRevision, evidenceId, workItemId } = proposal;
  return transition(defect, {
    actor: decision.actor, actorKind: decision.actorKind, role: decision.role, reason: decision.reason,
    expectedRevision: decision.expectedRevision, occurredAt: decision.occurredAt,
    inconclusiveCause: decision.inconclusiveCause,
    to, verificationOutcome, attemptId, candidateRevision, evidenceId,
    workItemId: workItemId ?? undefined
  }, policy);
}
