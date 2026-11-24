import { planNewListingAttributes, sellerAttributes, type AttributeValue } from "@app/core";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sandbox from "./fixtures/sandbox-responses.json";
import { ProductTypeDefinitionSchema } from "./product-type-definitions";
import { ProductTypeSchemaError, SANDBOX_PRODUCT_TYPE_SCHEMAS, listingAttributes, loadProductTypeSchema, productTypeFromSchema } from "./product-type-schema";
import { fakeAmazon, json, recordingLogger } from "./test-support";
import { USER_AGENT } from "./user-agent";

const US = "ATVPDKIKX0DER";
const definition = ProductTypeDefinitionSchema.parse(sandbox.getDefinitionsProductType_200_0);
const schema = SANDBOX_PRODUCT_TYPE_SCHEMAS.LUGGAGE!;
const facts = { dimensions: { lengthCm: 55, widthCm: 35, heightCm: 23 } };

describe("loadProductTypeSchema", () => {
  it("serves the sandbox's stand-in schema, since Amazon's sandbox links to none", async () => {
    const amazon = fakeAmazon();
    const loaded = await loadProductTypeSchema(definition, { environment: "sandbox", fetch: amazon.fetch });
    expect(loaded).toEqual(schema);
    expect(loaded).not.toBe(schema);
    expect(amazon.requests).toEqual([]);
    await expect(loadProductTypeSchema({ ...definition, productType: "BOTTLE" }, { environment: "sandbox" })).rejects.toThrow(ProductTypeSchemaError);
  });

  it("downloads the schema in production with the app's user agent, and checks its MD5 checksum", async () => {
    const body = JSON.stringify(schema);
    const checksum = createHash("md5").update(body).digest("hex");
    const amazon = fakeAmazon(() => new Response(body, { status: 200 }));
    const { logger, entries } = recordingLogger();
    const production = { ...definition, schema: { link: { resource: "https://selling-partner-definitions.s3.amazonaws.com/schema/LUGGAGE.json?X-Amz-Signature=abc", verb: "GET" }, checksum } };

    expect(await loadProductTypeSchema(production, { environment: "production", fetch: amazon.fetch, logger })).toEqual(schema);
    expect(amazon.requests[0]!.headers.get("user-agent")).toBe(USER_AGENT);
    expect(entries).toEqual([expect.objectContaining({ service: "schema", operation: "getProductTypeSchema", status: 200, userAgent: USER_AGENT })]);
    // The presigned link never reaches the log.
    expect(JSON.stringify(entries)).not.toContain("X-Amz-Signature");
  });

  it("refuses a schema that doesn't match its checksum, or a failed download", async () => {
    const tampered = fakeAmazon(() => new Response(JSON.stringify({ ...schema, required: [] }), { status: 200 }));
    const checksum = createHash("md5").update(JSON.stringify(schema)).digest("hex");
    const production = { ...definition, schema: { link: { resource: "https://example.com/LUGGAGE.json", verb: "GET" }, checksum } };
    await expect(loadProductTypeSchema(production, { environment: "production", fetch: tampered.fetch, logger: () => {} })).rejects.toThrow(
      "The LUGGAGE schema doesn't match its checksum.",
    );

    const expired = fakeAmazon(() => json(403, { message: "Request has expired" }));
    await expect(loadProductTypeSchema(production, { environment: "production", fetch: expired.fetch, logger: () => {} })).rejects.toThrow("failed with 403");
  });
});

describe("productTypeFromSchema", () => {
  const productType = productTypeFromSchema(definition, schema);
  const byName = new Map(productType.attributes.map((attribute) => [attribute.name, attribute]));

  it("asks for every required attribute and the recommended ones, in the definition's group order", () => {
    expect(productType).toMatchObject({ name: "LUGGAGE", displayName: "Luggage" });
    expect(productType.attributes.map((attribute) => [attribute.name, attribute.requirement])).toEqual([
      ["item_name", "required"],
      ["brand", "required"],
      ["item_type_keyword", "required"],
      ["supplier_declared_has_product_identifier_exemption", "required"],
      ["bullet_point", "required"],
      ["product_description", "required"],
      ["generic_keyword", "recommended"],
      ["country_of_origin", "required"],
      ["material", "required"],
      ["color", "recommended"],
      ["item_dimensions", "required"],
      ["main_product_image_locator", "required"],
    ]);
    // Required only when the seller has no GTIN exemption; the wizard doesn't collect GTINs yet.
    expect(byName.has("externally_assigned_product_identifier")).toBe(false);
  });

  it("fills what facts can, has the agent write the copy, and asks the seller for the rest", () => {
    expect(byName.get("brand")).toMatchObject({ fromFact: "brand", draftable: false });
    expect(byName.get("material")).toMatchObject({ fromFact: "materials", multiple: true });
    expect(byName.get("item_dimensions")).toMatchObject({ fromFact: "dimensions" });
    expect(byName.get("main_product_image_locator")).toMatchObject({ fromFact: "mainPhoto" });
    expect(byName.get("bullet_point")).toMatchObject({ draftable: true, multiple: true, maxLength: 500 });
    expect(byName.get("item_name")).toMatchObject({ draftable: true, multiple: false, maxLength: 200 });
    expect(byName.get("item_type_keyword")).toMatchObject({ draftable: true, options: ["Carry-On Luggage", "Checked Luggage", "Luggage Sets", "Garment Bags", "Travel Duffels"] });
    expect(sellerAttributes(productType).map((attribute) => [attribute.name, attribute.options?.slice(0, 2)])).toEqual([
      ["supplier_declared_has_product_identifier_exemption", ["Yes", "No"]],
      ["country_of_origin", ["China", "India"]],
      ["color", undefined],
    ]);
  });
});

describe("listingAttributes", () => {
  const values = (entries: Record<string, AttributeValue>) => new Map(Object.entries(entries));
  const where = { schema, facts, marketplaceId: US, languageTag: "en_US" };

  it("shapes each value the way its attribute's schema stores it", () => {
    const { attributes, unexpressed } = listingAttributes({
      ...where,
      values: values({
        item_name: "Trailcraft Hardside Carry-On Spinner",
        bullet_point: ["ROLLS QUIETLY – Four spinner wheels.", "PACKS FLAT – Two compartments."],
        supplier_declared_has_product_identifier_exemption: "Yes",
        country_of_origin: "Vietnam",
        item_type_keyword: "Carry-On Luggage",
        item_dimensions: "55 × 35 × 23 cm",
        main_product_image_locator: "https://images.example.com/carry-on.jpg",
      }),
    });
    expect(unexpressed).toEqual([]);
    expect(attributes).toEqual({
      item_name: [{ value: "Trailcraft Hardside Carry-On Spinner", language_tag: "en_US", marketplace_id: US }],
      bullet_point: [
        { value: "ROLLS QUIETLY – Four spinner wheels.", language_tag: "en_US", marketplace_id: US },
        { value: "PACKS FLAT – Two compartments.", language_tag: "en_US", marketplace_id: US },
      ],
      supplier_declared_has_product_identifier_exemption: [{ value: true, marketplace_id: US }],
      country_of_origin: [{ value: "VN", marketplace_id: US }],
      item_type_keyword: [{ value: "carry-on-luggage", marketplace_id: US }],
      item_dimensions: [
        { length: { value: 55, unit: "centimeters" }, width: { value: 35, unit: "centimeters" }, height: { value: 23, unit: "centimeters" }, marketplace_id: US },
      ],
      main_product_image_locator: [{ media_location: "https://images.example.com/carry-on.jpg", marketplace_id: US }],
    });
  });

  it("leaves out what it can't express, and says why", () => {
    const { attributes, unexpressed } = listingAttributes({
      ...where,
      values: values({ country_of_origin: "Atlantis", externally_assigned_product_identifier: "012345678905", flavor: "Mint" }),
    });
    expect(attributes).toEqual({});
    expect(unexpressed).toEqual([
      { attribute: "country_of_origin", label: "Country/Region of Origin", reason: `"Atlantis" isn't a value Amazon accepts for country/region of origin.` },
      { attribute: "externally_assigned_product_identifier", label: "External Product ID", reason: "Amazon wants type, value, marketplace_id for external product id, which the wizard doesn't collect." },
      { attribute: "flavor", label: "flavor", reason: "flavor isn't an attribute of this product type." },
    ]);
  });

  it("covers every attribute the wizard plans for a product type read from its schema", () => {
    const productType = productTypeFromSchema(definition, schema);
    const plan = planNewListingAttributes(
      productType,
      {
        brand: "Trailcraft",
        productName: "Hardside Carry-On Spinner",
        materials: ["Polycarbonate"],
        dimensions: facts.dimensions,
        certifications: [],
        photos: ["https://images.example.com/carry-on.jpg"],
      },
      { supplier_declared_has_product_identifier_exemption: "Yes", country_of_origin: "Vietnam" },
    );
    const given = new Map(plan.flatMap(({ attribute, value }) => (value === undefined ? [] : [[attribute.name, value] as const])));
    expect(listingAttributes({ ...where, values: given }).unexpressed).toEqual([]);
  });
});
