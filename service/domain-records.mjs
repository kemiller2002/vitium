// Typed identities and explicit v1 -> v2 record migration (VIT-DOM-001/002/003/005/006).
// Pure functions only. No clock, randomness, storage or network: callers pass effects in.
// Wire schemas: schemas/observation.v2.schema.json, schemas/defect.v2.schema.json.
// The F# core (domain/Vitium.Domain/Identity.fs) uses the same identity patterns.
import { resolveProduct } from "./product-registry.mjs";
import { impactCodes } from "./report-domain.mjs";

const ok = value => Object.freeze({ ok: true, value });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

// Distinct identity kinds. Patterns are deliberately non-overlapping so one kind can
// never be accepted where another is expected.
export const identityPatterns = Object.freeze({
  observationId: /^OBS-[a-f0-9]{32}$/,          // internal, never shown to reporters
  externalReference: /^VIT-[A-F0-9]{32}$/,      // opaque receipt; independent of GitHub numbers
  defectId: /^DEF-[0-9]{4,}$/,                  // internal defect identity
  productId: /^[a-z][a-z0-9-]{0,63}$/,
  actorId: /^[A-Za-z0-9._:/+=,@-]{1,256}$/,
  evidenceRef: /^[^\u0000-\u001f\u007f]{1,512}$/,
  workItemSystem: /^[a-z][a-z0-9-]{0,31}$/,
  workItemRef: /^[^\u0000-\u001f\u007f]{1,512}$/
});
export const provenanceClasses = Object.freeze(["anonymous-human", "authenticated-human", "application", "ci", "agent"]);
// "unrecorded" exists only for migrated records whose v1 source did not establish a
// provenance class; it is never produced for new records (VIT-DOM-005: no invention).
export const migratedProvenanceClasses = Object.freeze([...provenanceClasses, "unrecorded"]);

const makeId = kind => text => typeof text === "string" && identityPatterns[kind].test(text)
  ? ok(text) : fail("invalid_" + kind.replace(/[A-Z]/g, c => "_" + c.toLowerCase()), "Invalid " + kind + ".");
export const ObservationId = makeId("observationId");
export const ExternalReference = makeId("externalReference");
export const DefectId = makeId("defectId");
export const ProductId = makeId("productId");
export const ActorId = makeId("actorId");

export function Actor(id, provenance) {
  const checked = ActorId(id);
  if (!checked.ok) return checked;
  return provenanceClasses.includes(provenance) ? ok(Object.freeze({ id, provenance })) : fail("invalid_provenance", "Unknown provenance class.");
}

// --- v1 -> v2 migration ----------------------------------------------------------

// Single source for label -> code (VF-012): service/report-domain.mjs impactCodes.
const v1ImpactToId = impactCodes;

const productOf = (registry, text) => {
  const resolved = resolveProduct(registry, text);
  // Unresolvable names are kept verbatim as unmapped, never assigned to another product.
  return resolved.ok
    ? { status: "resolved", productId: resolved.value.id, reportedText: text }
    : { status: "unmapped", productId: null, reportedText: typeof text === "string" ? text : "" };
};

export const isObservationV1 = r => isObject(r) && r.kind === "observation" && r.schemaVersion === undefined
  && typeof r.pk === "string" && isObject(r.report) && r.report.schemaVersion === "1.0";
export const isDefectV1 = r => isObject(r) && r.schemaVersion === "1.0" && typeof r.id === "string" && /^VIT-[0-9]{4,}$/.test(r.id);

/**
 * Migrate a persisted v1 observation (shape produced by service/intake.mjs at bba1d59)
 * to observation v2. Deterministic: observationId derives from the stored request key.
 * History events are carried over verbatim; the original record is retained in
 * migration.original so no historical meaning is destroyed.
 */
export function migrateObservationV1(registry, v1) {
  if (!isObservationV1(v1)) return fail("unsupported_version", "Not a v1 observation record.");
  const key = /^REQUEST#([a-f0-9]{64})$/.exec(v1.pk);
  if (!key) return fail("invalid_record", "v1 observation key is malformed.");
  if (!identityPatterns.externalReference.test(v1.reference ?? "")) return fail("invalid_record", "v1 reference is malformed.");
  const impact = v1ImpactToId[v1.report.impact];
  const v2 = {
    schemaVersion: "2.0",
    kind: "observation",
    observationId: "OBS-" + key[1].slice(0, 32),
    externalReference: v1.reference,
    requestKey: v1.pk,
    payloadHash: v1.payloadHash,
    report: { ...v1.report },
    product: productOf(registry, v1.report.product),
    reportedImpact: impact ?? null,
    source: { channel: v1.source, provenance: v1.source === "public-api" ? "anonymous-human" : "unrecorded" },
    visibility: v1.visibility,
    state: v1.state,
    revision: v1.revision,
    history: Array.isArray(v1.history) ? v1.history.map(e => ({ ...e })) : [],
    triage: {},
    links: { defectIds: [] },
    receivedAt: v1.receivedAt,
    ...(v1.reviewQueuePk ? { reviewQueuePk: v1.reviewQueuePk } : {}),
    ...(v1.reviewQueueSk ? { reviewQueueSk: v1.reviewQueueSk } : {}),
    migration: { from: "observation/1.0", id: "observation-v1-to-v2", original: structuredClone(v1) }
  };
  return ok(deepFreeze(v2));
}

const v1SourceProvenance = Object.freeze({
  "public-github": "authenticated-human", // GitHub issue creation requires a signed-in account
  "public-api": "anonymous-human",
  ci: "ci",
  agent: "agent",
  manual: "unrecorded",   // operator-entered: original reporter provenance unknown
  dokimos: "unrecorded"   // tool channel; class not established by v1 data
});

/**
 * Migrate a v1 defect (schemas/defect.schema.json) to defect v2. VIT-0001 style ids
 * become DEF-0001 with legacyId retained. severity "unassessed" becomes absent
 * (no value inferred); impact is reported impact only; priority/confidence stay absent.
 */
export function migrateDefectV1(registry, v1) {
  if (!isDefectV1(v1)) return fail("unsupported_version", "Not a v1 defect record.");
  const severity = v1.severity && v1.severity !== "unassessed" ? v1.severity : undefined;
  const workItems = [
    ...(v1.githubIssueUrl ? [{ system: "github", ref: v1.githubIssueUrl, relation: "report-issue" }] : []),
    ...(v1.linkedIssueUrls || []).map(ref => ({ system: "github", ref, relation: "linked" }))
  ];
  const v2 = {
    schemaVersion: "2.0",
    kind: "defect",
    defectId: "DEF-" + v1.id.slice(4),
    legacyId: v1.id,
    externalReferences: v1.reportReference ? [v1.reportReference] : [],
    observationIds: [],
    source: { channel: v1.source, provenance: v1SourceProvenance[v1.source] ?? "unrecorded" },
    product: productOf(registry, v1.product),
    summary: {
      title: v1.title, observed: v1.observed, expected: v1.expected,
      ...(v1.steps !== undefined ? { steps: v1.steps } : {}),
      ...(v1.pageUrl !== undefined ? { pageUrl: v1.pageUrl } : {})
    },
    reportedImpact: v1.impact,
    triage: severity ? { severity } : {},
    evidence: (v1.evidenceUrls || []).map(ref => ({ kind: "unspecified", ref })),
    workItems,
    state: v1.state,
    revision: 0,
    history: [],
    createdAt: v1.createdAt,
    ...(v1.updatedAt ? { updatedAt: v1.updatedAt } : {}),
    ...(v1.dedupeKey ? { dedupeKey: v1.dedupeKey } : {}),
    ...(v1.rootCause !== undefined || v1.verification !== undefined
      ? { notes: { ...(v1.rootCause !== undefined ? { rootCause: v1.rootCause } : {}), ...(v1.verification !== undefined ? { verification: v1.verification } : {}) } }
      : {}),
    migration: { from: "defect/1.0", id: "defect-v1-to-v2", original: structuredClone(v1) }
  };
  return ok(deepFreeze(v2));
}

/** Version negotiation: v2 passes through, v1 migrates, anything else is refused. */
export function migrate(registry, record) {
  if (isObject(record) && record.schemaVersion === "2.0" && (record.kind === "observation" || record.kind === "defect")) return ok(record);
  if (isObservationV1(record)) return migrateObservationV1(registry, record);
  if (isDefectV1(record)) return migrateDefectV1(registry, record);
  return fail("unsupported_version", "Unsupported or unrecognised record version.");
}
