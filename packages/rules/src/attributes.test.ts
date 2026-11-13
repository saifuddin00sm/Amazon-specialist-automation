import { ViolationSchema } from "@app/core";
import { describe, expect, it } from "vitest";
import { validateAttributes } from "./attributes";

const marketplaceId = "ATVPDKIKX0DER";

/** A cut-down product type schema in the shape getDefinitionsProductType links to. */
const bottleSchema = {
  $schema: "https://schemas.amazon.com/selling-partners/definitions/product-types/meta-schema/v1",
  $id: "https://schemas.amazon.com/selling-partners/definitions/product-types/schema/v1/BOTTLE",
  type: "object",
  required: ["item_name", "brand"],
  additionalProperties: false,
  properties: {
    item_name: {
      title: "Item Name",
      editable: true,
      hidden: false,
      type: "array",
      minItems: 1,
      selectors: ["marketplace_id", "language_tag"],
      maxUniqueItems: 1,
      items: {
        type: "object",
        required: ["value", "marketplace_id"],
        additionalProperties: false,
        properties: {
          value: { type: "string", minLength: 1, maxLength: 200, maxUtf8ByteLength: 200 },
          language_tag: { type: "string" },
          marketplace_id: { type: "string" },
        },
      },
    },
    brand: {
      type: "array",
      items: { type: "object", required: ["value"], properties: { value: { type: "string", minUtf8ByteLength: 1 } } },
    },
    color: {
      type: "array",
      items: { type: "object", properties: { value: { type: "string", enum: ["Red", "Blue"], enumNames: ["Red", "Blue"] } } },
    },
    capacity: {
      type: "array",
      items: {
        type: "object",
        required: ["value", "unit"],
        properties: { value: { type: "number", exclusiveMinimum: 0 }, unit: { type: "string", enum: ["milliliters", "liters"] } },
      },
    },
    release_date: { type: "array", items: { type: "object", properties: { value: { type: "string", format: "date" } } } },
  },
};

const valid = {
  item_name: [{ value: "Northlane Insulated Water Bottle", language_tag: "en_US", marketplace_id: marketplaceId }],
  brand: [{ value: "Northlane" }],
  color: [{ value: "Blue" }],
  capacity: [{ value: 946, unit: "milliliters" }],
  release_date: [{ value: "2026-11-01" }],
};

const paths = (payload: unknown) => validateAttributes(payload, bottleSchema).map(({ path, keyword }) => [path, keyword]);

describe("validateAttributes", () => {
  it("passes attributes that match the schema, ignoring Amazon's UI keywords", () => {
    expect(validateAttributes(valid, bottleSchema)).toEqual([]);
  });

  it("reports a missing required attribute at its own path", () => {
    const payload: Record<string, unknown> = { ...valid };
    delete payload.brand;
    expect(validateAttributes(payload, bottleSchema)).toEqual([
      { rule: "attribute_schema", severity: "error", keyword: "required", path: "/brand", match: "brand", message: '"brand" is required.' },
    ]);
  });

  it("reports an attribute the product type doesn't have", () => {
    expect(validateAttributes({ ...valid, flavor: [{ value: "Mint" }] }, bottleSchema)).toEqual([
      { rule: "attribute_schema", severity: "error", keyword: "additionalProperties", path: "/flavor", match: "flavor", message: '"flavor" isn\'t an attribute of this product type.' },
    ]);
  });

  it("reports every problem at once, each with a JSON pointer", () => {
    const payload = { ...valid, item_name: [{ value: "", language_tag: "en_US" }], capacity: [{ value: 0, unit: "gallons" }] };
    expect(paths(payload)).toEqual([
      ["/item_name/0/marketplace_id", "required"],
      ["/item_name/0/value", "minLength"],
      ["/capacity/0/value", "exclusiveMinimum"],
      ["/capacity/0/unit", "enum"],
    ]);
  });

  it("lists the allowed values of an enum", () => {
    const [violation] = validateAttributes({ ...valid, color: [{ value: "Green" }] }, bottleSchema);
    expect(violation?.message).toBe('/color/0/value must be equal to one of the allowed values: "Red", "Blue".');
  });

  it("checks types", () => {
    expect(paths({ ...valid, capacity: [{ value: "946", unit: "milliliters" }] })).toEqual([["/capacity/0/value", "type"]]);
    expect(paths({ ...valid, item_name: "Bottle" })).toEqual([["/item_name", "type"]]);
  });

  it("checks Amazon's UTF-8 byte limits, which are tighter than character limits for non-ASCII text", () => {
    const title = (value: string) => ({ ...valid, item_name: [{ value, marketplace_id: marketplaceId }] });
    expect(validateAttributes(title("é".repeat(100)), bottleSchema)).toEqual([]);
    expect(validateAttributes(title("é".repeat(101)), bottleSchema)).toEqual([
      {
        rule: "attribute_schema",
        severity: "error",
        keyword: "maxUtf8ByteLength",
        path: "/item_name/0/value",
        message: "/item_name/0/value must be at most 200 bytes in UTF-8.",
      },
    ]);
    expect(paths({ ...valid, brand: [{ value: "" }] })).toEqual([["/brand/0/value", "minUtf8ByteLength"]]);
  });

  it("checks formats", () => {
    expect(paths({ ...valid, release_date: [{ value: "next week" }] })).toEqual([["/release_date/0/value", "format"]]);
  });

  it("reports a payload that isn't an object at the root", () => {
    expect(validateAttributes(null, bottleSchema)).toMatchObject([{ path: "/", keyword: "type", message: "/ must be object." }]);
  });

  it("reports if/then requirements by the keyword that failed, not the if", () => {
    const schema = {
      type: "object",
      if: { required: ["capacity"] },
      then: { required: ["unit_count"] },
    };
    expect(validateAttributes({ capacity: [] }, schema).map(({ keyword, path }) => [keyword, path])).toEqual([["required", "/unit_count"]]);
  });

  it("returns violations that match the core Violation schema", () => {
    const violations = validateAttributes({ color: [{ value: 1 }] }, bottleSchema);
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) expect(ViolationSchema.parse(violation)).toEqual(violation);
  });

  it("escapes / and ~ in property names in the path", () => {
    expect(validateAttributes({}, { type: "object", required: ["a/b~c"] })[0]?.path).toBe("/a~1b~0c");
  });

  it("validates against two schemas that share an $id", () => {
    const strict = { ...bottleSchema, required: [...bottleSchema.required, "color"] };
    const payload: Record<string, unknown> = { ...valid };
    delete payload.color;
    expect(validateAttributes(payload, bottleSchema)).toEqual([]);
    expect(validateAttributes(payload, strict).map(({ path }) => path)).toEqual(["/color"]);
  });

  it("returns one product_type_schema violation for a schema it can't use", () => {
    expect(validateAttributes(valid, { type: "object", properties: { a: { $ref: "#/missing" } } })).toMatchObject([{ rule: "product_type_schema", severity: "error" }]);
    expect(validateAttributes(valid, "not a schema")).toMatchObject([{ rule: "product_type_schema", message: "The product type schema can't be used: it isn't a JSON object." }]);
    expect(validateAttributes(valid, [])).toMatchObject([{ rule: "product_type_schema" }]);
  });
});
