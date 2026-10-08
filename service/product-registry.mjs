// Canonical product registry resolution (VIT-DOM-004). Pure functions over the
// registry data in schemas/products.v1.json; the F# core resolves the same file with
// the same normalisation rule. Unsupported names are refused, never silently mapped.
//
// Packaging note: service/report-domain.mjs keeps its own frozen display-name lists
// because the AWS Lambda candidate packages only service/ (CodeUri ../../service/);
// tests/domain-registry.test.mjs fails if those lists, site/submission.mjs and this
// registry diverge.
const ok = value => Object.freeze({ ok: true, value });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });

/** Deterministic alias key: NFKC, trim, collapse whitespace, lower-case. */
export const aliasKey = text => String(text).normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

const ID = /^[a-z][a-z0-9-]{0,63}$/;

/** Validate a registry and build lookup indexes. Fails closed on ambiguity. */
export function loadRegistry(raw) {
  const bad = message => fail("invalid_registry", message);
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== "1.0") return bad("Unsupported registry version.");
  if (!Array.isArray(raw.products) || !Array.isArray(raw.impacts)) return bad("products and impacts are required.");
  const byKey = new Map(), byId = new Map();
  for (const p of raw.products) {
    if (!ID.test(p?.id ?? "") || typeof p.displayName !== "string" || !p.displayName.trim() || !Array.isArray(p.aliases)) return bad("Invalid product entry.");
    if (byId.has(p.id)) return bad("Duplicate product id " + p.id + ".");
    byId.set(p.id, p);
    for (const name of new Set([p.id, p.displayName, ...p.aliases].map(aliasKey))) {
      if (byKey.has(name) && byKey.get(name) !== p.id) return bad("Alias " + name + " is ambiguous.");
      byKey.set(name, p.id);
    }
  }
  if (raw.products.filter(p => p.unknown === true).length !== 1 || byId.get("unknown")?.unknown !== true) return bad("Exactly one explicit 'unknown' product (id unknown) is required.");
  const impactIds = new Set(), impactNames = new Set();
  for (const i of raw.impacts) {
    if (!ID.test(i?.id ?? "") || typeof i.displayName !== "string" || impactIds.has(i.id) || impactNames.has(i.displayName)) return bad("Invalid impact entry.");
    impactIds.add(i.id); impactNames.add(i.displayName);
  }
  const normalised = Object.freeze(raw.products.map(p => Object.freeze({ id: p.id, displayName: p.displayName, aliases: Object.freeze([...p.aliases]), unknown: p.unknown === true })));
  return ok(Object.freeze({
    version: raw.registryVersion,
    products: normalised,
    impacts: Object.freeze(raw.impacts.map(i => Object.freeze({ id: i.id, displayName: i.displayName }))),
    byKey, byId: new Map(normalised.map(p => [p.id, p]))
  }));
}

/** Resolve an id, display name or alias. Unknown text is refused, not mapped. */
export function resolveProduct(registry, text) {
  if (typeof text !== "string" || !text.trim()) return fail("product_required", "A product is required.");
  if (text.length > 100 || /[\u0000-\u001f\u007f]/u.test(text)) return fail("unsupported_product", "Choose a supported application.");
  const id = registry.byKey.get(aliasKey(text));
  if (!id) return fail("unsupported_product", "Choose a supported application.");
  const p = registry.byId.get(id);
  const matchedAlias = aliasKey(text) !== aliasKey(p.id) && aliasKey(text) !== aliasKey(p.displayName);
  return ok(Object.freeze({ id: p.id, displayName: p.displayName, unknown: p.unknown, matchedAlias }));
}

/** Resolve a reported-impact display name or id. */
export function resolveImpact(registry, text) {
  if (typeof text !== "string" || !text.trim()) return fail("impact_required", "An impact is required.");
  const found = registry.impacts.find(i => i.id === text.trim() || i.displayName === text.trim());
  return found ? ok(found) : fail("unsupported_impact", "Choose a supported impact.");
}

export const productDisplayNames = registry => registry.products.map(p => p.displayName);
export const impactDisplayNames = registry => registry.impacts.map(i => i.displayName);
