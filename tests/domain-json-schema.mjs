// Strict JSON Schema 2020-12 SUBSET validator for Vitium domain schema tests. No dependency.
// Any keyword it does not implement is reported as an error, so schemas cannot silently
// rely on unchecked keywords. Not a general-purpose validator.
import { readFileSync } from "node:fs";

export const readSchema = path => JSON.parse(readFileSync(new URL("../schemas/" + path, import.meta.url), "utf8"));
const read = readSchema;
export const SUPPORTED = new Set(["$schema", "$id", "title", "description", "$defs", "$ref", "type", "properties", "required",
  "additionalProperties", "enum", "const", "pattern", "minLength", "maxLength", "minimum", "items", "uniqueItems",
  "format", "writeOnly"]);

export function validate(schema, value, { file, root, at = "$" } = {}) {
  root ??= schema;
  const errors = [];
  for (const key of Object.keys(schema)) if (!SUPPORTED.has(key)) errors.push(at + ": unsupported keyword " + key + " in " + file);
  if (schema.$ref) {
    const [target, pointer] = schema.$ref.split("#");
    const doc = target ? read(target) : root;
    const sub = (pointer || "").split("/").filter(Boolean).reduce((s, k) => s?.[k], doc);
    if (!sub) return [at + ": unresolved $ref " + schema.$ref];
    return [...errors, ...validate(sub, value, { file: target || file, root: doc, at })];
  }
  const typeOf = v => v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) return [...errors, at + ": expected " + types + " got " + t];
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(at + ": const mismatch");
  if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) errors.push(at + ": not in enum (" + JSON.stringify(value) + ")");
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(at + ": pattern " + schema.pattern);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(at + ": too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(at + ": too long");
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(at + ": below minimum");
  if (Array.isArray(value)) {
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(at + ": items not unique");
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, { file, root, at: at + "[" + i + "]" })));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const r of schema.required || []) if (!(r in value)) errors.push(at + ": missing " + r);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validate(schema.properties[k], v, { file, root, at: at + "." + k }));
      else if (schema.additionalProperties === false) errors.push(at + ": unexpected property " + k);
      else if (typeof schema.additionalProperties === "object") errors.push(...validate(schema.additionalProperties, v, { file, root, at: at + "." + k }));
    }
  }
  return errors;
}
export const validateFile = (schemaFile, value) => validate(read(schemaFile), value, { file: schemaFile });

