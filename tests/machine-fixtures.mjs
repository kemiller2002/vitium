// Shared helpers for tests/machine-*.test.mjs (not a test file itself).
// The fake verifier stands in for a future workload-identity exchange; the credential
// strings are opaque test labels, not credentials.
import { readFileSync } from "node:fs";
import { makePrincipalVerifier } from "../service/machine/principal.mjs";
import { makeMachineIntake } from "../service/machine/observation-core.mjs";
import { makeMemoryStore } from "../service/machine/memory-store.mjs";

export const NOW = "2026-10-08T16:00:00.000Z";
export const example = name => JSON.parse(readFileSync(new URL("../schemas/machine/examples/" + name, import.meta.url), "utf8"));
export const body = value => JSON.stringify(value);

const ALL_TYPES = ["observation.detected", "verification.failed", "verification.passed", "verification.inconclusive", "governance.violation"];
export const CLAIMS = Object.freeze({
  "label-ci": { principalId: "wl:ci:summa", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ALL_TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  "label-dokimos": { principalId: "wl:dokimos:summa", system: "dokimos", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["verification.failed", "verification.passed", "verification.inconclusive", "observation.detected"], expiresAt: "2026-10-08T17:00:00Z" },
  "label-ordo": { principalId: "wl:ordo:summa", system: "ordo", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["governance.violation"], expiresAt: "2026-10-08T17:00:00Z" },
  "label-tutela": { principalId: "wl:tutela:summa", system: "tutela", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["observation.detected"], expiresAt: "2026-10-08T17:00:00Z" },
  "label-ci-other-repo": { principalId: "wl:ci:other", system: "ci", repositories: ["kemiller2002/other"], environments: ["ci"], eventTypes: ALL_TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  "label-ci-prod-only": { principalId: "wl:ci:prod", system: "ci", repositories: ["kemiller2002/summa"], environments: ["production"], eventTypes: ALL_TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  "label-ci-detect-only": { principalId: "wl:ci:detect", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ["observation.detected"], expiresAt: "2026-10-08T17:00:00Z" },
  "label-ci-expired": { principalId: "wl:ci:old", system: "ci", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: ALL_TYPES, expiresAt: "2026-10-08T15:59:59Z" },
  "label-vitium": { principalId: "wl:vitium:self", system: "vitium", repositories: ["kemiller2002/vitium"], environments: ["ci"], eventTypes: ALL_TYPES, expiresAt: "2026-10-08T17:00:00Z" },
  "label-ci-vitium-repo": { principalId: "wl:ci:vitium", system: "ci", repositories: ["kemiller2002/vitium"], environments: ["ci"], eventTypes: ALL_TYPES, expiresAt: "2026-10-08T17:00:00Z" }
});

export const fakeVerifier = async credential => credential === "label-unavailable"
  ? { ok: false, error: "unavailable" }
  : CLAIMS[credential] ? { ok: true, value: structuredClone(CLAIMS[credential]) } : { ok: false, error: "invalid" };
export const verify = makePrincipalVerifier(fakeVerifier);
export async function principal(label) {
  const r = await verify(label);
  if (!r.ok) throw new Error("fixture principal failed: " + label);
  return r.value;
}

let counter = 0;
export const obsId = () => "OBS-" + (++counter).toString(16).padStart(32, "0");

export function harness({ faults, attempts = {} } = {}) {
  const store = makeMemoryStore({ faults });
  const lookupAttempt = async (defectId, attemptId) => {
    const a = attempts[defectId + "#" + attemptId];
    return { ok: true, value: a ? { found: true, author: a } : { found: false } };
  };
  const intake = makeMachineIntake({ store, now: () => NOW, observationId: obsId, lookupAttempt });
  return { store, intake };
}
