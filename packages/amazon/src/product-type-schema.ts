import {
  LISTING_COPY_ATTRIBUTES,
  ProductTypeSchema as AppProductTypeSchema,
  type AttributeValue,
  type NewProductFacts,
  type ProductFactKey,
  type ProductType as AppProductType,
  type ProductTypeAttribute,
} from "@app/core";
import { createHash } from "node:crypto";
import { amazonEnvironment, type AmazonEnvironment } from "./endpoints";
import luggageSchema from "./fixtures/luggage-product-type-schema.json";
import { amazonFetch, consoleLogger, type AmazonLogger, type Fetch } from "./http";
import type { ProductTypeDefinition } from "./product-type-definitions";

// A product type's JSON schema (the one getDefinitionsProductType links to) read two ways: as the
// attributes the New listing wizard asks for, and as the shape each attribute's value takes when a
// listing is put to Amazon. Attribute values follow Amazon's listing attribute JSON: an array of
// entries, each with its value and the marketplace (and language) it is for.

export type JsonSchema = Record<string, unknown>;

/** The schema couldn't be downloaded or doesn't match its checksum. Holds no URL: links are presigned. */
export class ProductTypeSchemaError extends Error {
  override name = "ProductTypeSchemaError";
}

/**
 * Amazon's sandbox answers getDefinitionsProductType with a placeholder link, so the sandbox serves
 * these schemas instead, by product type.
 */
export const SANDBOX_PRODUCT_TYPE_SCHEMAS: Readonly<Record<string, JsonSchema>> = { LUGGAGE: luggageSchema };

export type LoadSchemaOptions = {
  environment?: AmazonEnvironment;
  fetch?: Fetch;
  logger?: AmazonLogger;
  now?: () => number;
};

/**
 * Downloads a product type's JSON schema from the definition's link, with the app's user agent, and
 * checks it against the definition's checksum (an MD5 digest). The link expires, so call this soon
 * after getDefinitionsProductType. In the sandbox, serves SANDBOX_PRODUCT_TYPE_SCHEMAS.
 */
export async function loadProductTypeSchema(
  definition: Pick<ProductTypeDefinition, "productType" | "schema">,
  { environment = amazonEnvironment(), fetch = globalThis.fetch, logger = consoleLogger, now = Date.now }: LoadSchemaOptions = {},
): Promise<JsonSchema> {
  if (environment === "sandbox") {
    const schema = SANDBOX_PRODUCT_TYPE_SCHEMAS[definition.productType];
    if (!schema) throw new ProductTypeSchemaError(`The sandbox has no schema for ${definition.productType}; it has ${Object.keys(SANDBOX_PRODUCT_TYPE_SCHEMAS).join(", ")}.`);
    return structuredClone(schema);
  }

  const { link, checksum } = definition.schema;
  const response = await amazonFetch(
    { service: "schema", operation: "getProductTypeSchema", attempt: 1, url: link.resource, init: { method: link.verb } },
    fetch,
    logger,
    now,
  );
  if (!response.ok) throw new ProductTypeSchemaError(`Downloading the ${definition.productType} schema failed with ${response.status}.`);
  const body = Buffer.from(await response.arrayBuffer());
  const digest = createHash("md5").update(body);
  const [hex, base64] = [digest.copy().digest("hex"), digest.digest("base64")];
  if (checksum.toLowerCase() !== hex && checksum !== base64) {
    throw new ProductTypeSchemaError(`The ${definition.productType} schema doesn't match its checksum.`);
  }
  let schema: unknown;
  try {
    schema = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ProductTypeSchemaError(`The ${definition.productType} schema isn't JSON.`);
  }
  if (!isObject(schema)) throw new ProductTypeSchemaError(`The ${definition.productType} schema isn't a JSON object.`);
  return schema;
}

/** Attributes a new listing should have even though the schema doesn't require them. */
const RECOMMENDED_ATTRIBUTES = new Set(["bullet_point", "product_description", "generic_keyword", "item_type_keyword", "material", "item_dimensions", "color"]);

/** The product fact that fills an attribute, by Amazon's attribute name. */
const FACT_ATTRIBUTES: Readonly<Record<string, ProductFactKey>> = {
  brand: "brand",
  material: "materials",
  item_dimensions: "dimensions",
  item_length_width_height: "dimensions",
  main_product_image_locator: "mainPhoto",
};

/** Attributes the listing agent writes: the copy, and the browse keyword it picks from Amazon's list. */
const DRAFTABLE_ATTRIBUTES = new Set<string>([...Object.values(LISTING_COPY_ATTRIBUTES), "item_type_keyword"]);

const YES_NO = ["Yes", "No"];

/**
 * The attributes the New listing wizard asks about for a product type, read from its JSON schema:
 * every required attribute, and the recommended ones the schema has, in the definition's property
 * group order. Facts fill what they can, the agent drafts the copy, and the seller types the rest.
 */
export function productTypeFromSchema(definition: Pick<ProductTypeDefinition, "productType" | "displayName" | "propertyGroups">, schema: JsonSchema): AppProductType {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []);
  const grouped = Object.values(definition.propertyGroups).flatMap((group) => group.propertyNames ?? []);
  const names = [...new Set([...grouped, ...Object.keys(properties)])].filter((name) => name in properties && (required.has(name) || RECOMMENDED_ATTRIBUTES.has(name)));

  const attributes = names.map((name): ProductTypeAttribute => {
    const property = resolve(schema, properties[name]);
    const value = valueSchema(schema, property);
    const fromFact = FACT_ATTRIBUTES[name];
    const draftable = DRAFTABLE_ATTRIBUTES.has(name);
    const label = text(property.title) ?? name;
    const maxItems = typeof property.maxItems === "number" ? property.maxItems : 1;
    const options = value?.type === "boolean" ? YES_NO : enumOptions(value);
    const maxLength = typeof value?.maxLength === "number" ? value.maxLength : undefined;
    return {
      name,
      label,
      description: text(property.description) ?? label,
      requirement: required.has(name) ? "required" : "recommended",
      // The seller types one value into the wizard for anything no fact fills and the agent can't write.
      multiple: maxItems > 1 && (fromFact !== undefined || draftable),
      ...(fromFact ? { fromFact } : {}),
      draftable,
      ...(options ? { options } : {}),
      ...(maxLength ? { maxLength } : {}),
    };
  });

  return AppProductTypeSchema.parse({
    name: definition.productType,
    displayName: definition.displayName,
    description: `Amazon's ${definition.displayName} product type (${definition.productType}).`,
    attributes,
  });
}

/** A value the schema's shape for it can't hold, or that the wizard doesn't collect. */
export type UnexpressedAttribute = { attribute: string; label: string; reason: string };

export type ListingAttributesInput = {
  schema: JsonSchema;
  /** Each attribute's value, by name: from the facts, the seller or the agent. */
  values: ReadonlyMap<string, AttributeValue>;
  /** For structured values the text form doesn't carry, like dimensions. */
  facts: Pick<NewProductFacts, "dimensions">;
  marketplaceId: string;
  languageTag: string;
};

/**
 * The listing's attributes the way a put sends them, each value shaped by its attribute's schema:
 * text with its language and marketplace, an image's media location, dimensions with units, a yes or
 * no as a boolean, a label from the wizard as the code Amazon stores. Values whose shape the wizard
 * can't fill come back in `unexpressed` and are left out.
 */
export function listingAttributes({ schema, values, facts, marketplaceId, languageTag }: ListingAttributesInput): {
  attributes: Record<string, Record<string, unknown>[]>;
  unexpressed: UnexpressedAttribute[];
} {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const attributes: Record<string, Record<string, unknown>[]> = {};
  const unexpressed: UnexpressedAttribute[] = [];

  for (const [name, value] of values) {
    const property = resolve(schema, properties[name]);
    const label = text(property.title) ?? name;
    const items = resolve(schema, property.items);
    const fields = isObject(items.properties) ? items.properties : {};
    const where = (entry: Record<string, unknown>) => ({
      ...entry,
      ...("language_tag" in fields ? { language_tag: languageTag } : {}),
      ...("marketplace_id" in fields ? { marketplace_id: marketplaceId } : {}),
    });
    const missing = (reason: string) => unexpressed.push({ attribute: name, label, reason });

    if (!(name in properties)) {
      missing(`${name} isn't an attribute of this product type.`);
    } else if ("media_location" in fields) {
      attributes[name] = list(value).map((location) => where({ media_location: location }));
    } else if (["length", "width", "height"].every((side) => side in fields)) {
      const lengthFields = resolve(schema, fields.length).properties;
      const unit = resolve(schema, isObject(lengthFields) ? lengthFields.unit : undefined);
      if (Array.isArray(unit.enum) && !unit.enum.includes("centimeters")) {
        missing(`Amazon takes ${label.toLowerCase()} in ${unit.enum.join(", ")}, not centimeters.`);
        continue;
      }
      const { lengthCm, widthCm, heightCm } = facts.dimensions;
      const side = (cm: number) => ({ value: cm, unit: "centimeters" });
      attributes[name] = [where({ length: side(lengthCm), width: side(widthCm), height: side(heightCm) })];
    } else if ("value" in fields && requiredFields(items).every((field) => SIMPLE_FIELDS.has(field))) {
      const field = resolve(schema, fields.value);
      const entries: Record<string, unknown>[] = [];
      for (const given of list(value)) {
        const coerced = coerce(field, given);
        if (coerced === undefined) {
          missing(`"${given}" isn't a value Amazon accepts for ${label.toLowerCase()}.`);
          break;
        }
        entries.push(where({ value: coerced }));
      }
      if (entries.length === list(value).length) attributes[name] = entries;
    } else {
      missing(`Amazon wants ${Object.keys(fields).join(", ")} for ${label.toLowerCase()}, which the wizard doesn't collect.`);
    }
  }
  return { attributes, unexpressed };
}

/** An entry the wizard can fill holds a value, and where it applies. */
const SIMPLE_FIELDS = new Set(["value", "language_tag", "marketplace_id"]);

function requiredFields(items: JsonSchema): string[] {
  return Array.isArray(items.required) ? items.required.filter((field): field is string => typeof field === "string") : [];
}

/** A text value as the type the schema stores, or undefined when it can't be. */
function coerce(field: JsonSchema, value: string): unknown {
  switch (field.type) {
    case "boolean": {
      const answer = value.trim().toLowerCase();
      return answer === "yes" || answer === "true" ? true : answer === "no" || answer === "false" ? false : undefined;
    }
    case "number":
    case "integer": {
      const number = Number(value.trim());
      return Number.isFinite(number) && (field.type === "number" || Number.isInteger(number)) ? number : undefined;
    }
    default: {
      if (!Array.isArray(field.enum)) return value;
      if (field.enum.includes(value)) return value;
      // The wizard shows enumNames; Amazon stores the enum value at the same index.
      const names = Array.isArray(field.enumNames) ? field.enumNames : [];
      const at = names.findIndex((name) => typeof name === "string" && name.toLowerCase() === value.trim().toLowerCase());
      return at >= 0 ? field.enum[at] : undefined;
    }
  }
}

/** The schema of an attribute's `value`, when its entries have one. */
function valueSchema(root: JsonSchema, property: JsonSchema): JsonSchema | undefined {
  const items = resolve(root, property.items);
  const fields = isObject(items.properties) ? items.properties : {};
  return "value" in fields ? resolve(root, fields.value) : undefined;
}

/** What the wizard offers for an enumerated value: Amazon's display names when it has them. */
function enumOptions(value: JsonSchema | undefined): string[] | undefined {
  if (!value || !Array.isArray(value.enum) || value.enum.length === 0) return undefined;
  const names = Array.isArray(value.enumNames) && value.enumNames.length === value.enum.length ? value.enumNames : value.enum;
  const options = names.map(String).filter((option) => option.length > 0);
  return options.length > 0 ? options : undefined;
}

/** Follows a local $ref ("#/$defs/…"); anything else comes back as is, or empty. */
function resolve(root: JsonSchema, node: unknown): JsonSchema {
  if (!isObject(node)) return {};
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  let target: unknown = root;
  for (const segment of ref.slice(2).split("/")) target = isObject(target) ? target[segment.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  return isObject(target) ? target : {};
}

function list(value: AttributeValue): string[] {
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
