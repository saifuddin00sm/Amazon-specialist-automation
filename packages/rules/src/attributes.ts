import Ajv2019, { type ErrorObject, type ValidateFunction } from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { utf8ByteLength, type Violation } from "@app/core";

/**
 * Amazon's product type schemas are JSON Schema 2019-09 with a vocabulary of their own. The byte
 * lengths are checked; the rest only describe the UI or how Amazon merges values, so Ajv ignores them.
 */
const AMAZON_ANNOTATIONS = ["editable", "hidden", "enumNames", "selectors", "maxUniqueItems"];

const validators = new WeakMap<object, ValidateFunction | Error>();

/** Every way a listing's attributes break its product type's JSON schema (from getDefinitionsProductType). */
export function validateAttributes(payload: unknown, productTypeSchema: unknown): Violation[] {
  const validate = validatorFor(productTypeSchema);
  if (validate instanceof Error) {
    return [{ rule: "product_type_schema", severity: "error", message: `The product type schema can't be used: ${validate.message}` }];
  }
  if (validate(payload)) return [];
  // An if/then failure is reported again by the keyword inside `then` that failed.
  return (validate.errors ?? []).filter((error) => error.keyword !== "if").map(toViolation);
}

function validatorFor(schema: unknown): ValidateFunction | Error {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return new Error("it isn't a JSON object.");
  const cached = validators.get(schema);
  if (cached) return cached;
  let compiled: ValidateFunction | Error;
  try {
    compiled = createAjv().compile(withoutAmazonMetaSchema(schema as Record<string, unknown>));
  } catch (error) {
    compiled = error instanceof Error ? error : new Error(String(error));
  }
  validators.set(schema, compiled);
  return compiled;
}

/** A fresh instance per schema, so two schemas with the same $id don't clash. */
function createAjv(): Ajv2019 {
  const ajv = new Ajv2019({ allErrors: true, strict: false, logger: false });
  addFormats(ajv);
  ajv.addVocabulary(AMAZON_ANNOTATIONS);
  ajv.addKeyword({
    keyword: "maxUtf8ByteLength",
    type: "string",
    schemaType: "number",
    error: { message: ({ schema }) => `must be at most ${schema} bytes in UTF-8` },
    validate: (max: number, value: string) => utf8ByteLength(value) <= max,
  });
  ajv.addKeyword({
    keyword: "minUtf8ByteLength",
    type: "string",
    schemaType: "number",
    error: { message: ({ schema }) => `must be at least ${schema} bytes in UTF-8` },
    validate: (min: number, value: string) => utf8ByteLength(value) >= min,
  });
  return ajv;
}

/** Ajv can't fetch Amazon's meta-schema, and the 2019-09 vocabulary it builds on is the one we compile with. */
function withoutAmazonMetaSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema.$schema !== "string" || schema.$schema.startsWith("https://json-schema.org/")) return schema;
  const copy = { ...schema };
  delete copy.$schema;
  return copy;
}

function toViolation(error: ErrorObject): Violation {
  const base = { rule: "attribute_schema" as const, severity: "error" as const, keyword: error.keyword };
  if (error.keyword === "required") {
    const property = String(error.params.missingProperty);
    return { ...base, path: `${error.instancePath}/${escapePointer(property)}`, message: `"${property}" is required.`, match: property };
  }
  if (error.keyword === "additionalProperties") {
    const property = String(error.params.additionalProperty);
    return { ...base, path: `${error.instancePath}/${escapePointer(property)}`, message: `"${property}" isn't an attribute of this product type.`, match: property };
  }
  const path = error.instancePath === "" ? "/" : error.instancePath;
  const allowed = error.keyword === "enum" ? `: ${(error.params.allowedValues as unknown[]).map((value) => JSON.stringify(value)).join(", ")}` : "";
  return { ...base, path, message: `${path} ${error.message ?? "is invalid"}${allowed}.` };
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
