import { LISTING_LIMITS, ViolationSchema, type ListingCopy } from "@app/core";
import { describe, expect, it } from "vitest";
import { checkListingCopy, listingAttributes, listingLimits } from "./listing";

const marketplaceId = "ATVPDKIKX0DER";
const languageTag = "en_US";

const text = (limits: Record<string, number>) => ({
  type: "array",
  items: {
    type: "object",
    required: ["value", "marketplace_id"],
    additionalProperties: false,
    properties: { value: { type: "string", minLength: 1, ...limits }, language_tag: { type: "string" }, marketplace_id: { type: "string" } },
  },
});

/** A cut-down product type schema in the shape getDefinitionsProductType links to. */
const schema = {
  $schema: "https://schemas.amazon.com/selling-partners/definitions/product-types/meta-schema/v1",
  type: "object",
  required: ["item_name", "brand", "bullet_point"],
  additionalProperties: false,
  properties: {
    item_name: { ...text({ maxLength: 150 }), maxUniqueItems: 1 },
    brand: text({ maxLength: 50 }),
    bullet_point: { ...text({ maxLength: 300 }), maxItems: 3 },
    product_description: text({ maxLength: 2000 }),
    generic_keyword: text({ maxUtf8ByteLength: 100 }),
  },
};

const copy: ListingCopy = {
  title: "Yay! Kids Bento Lunch Box, 4 Compartments, Ocean Blue",
  bullets: ["FOUR COMPARTMENTS – Keep foods apart.", "EASY LATCH – A child can open it.", "WHAT'S INCLUDED – Box, divider, sauce cup."],
  description: "A bento box for school lunches.",
  backendKeywords: "school lunch container",
};

const options = { brand: "Yay! Kids", category: "LUNCH_BOX", productTypeSchema: schema, marketplaceId, languageTag };

describe("checkListingCopy", () => {
  it("passes clean copy, allowing a banned character inside the brand and attributes a patch doesn't send", () => {
    expect(checkListingCopy(copy, options)).toEqual([]);
  });

  it("finds Amazon's prohibited claims and the product's own in every field, naming the field", () => {
    const violations = checkListingCopy(
      { ...copy, bullets: [copy.bullets[0]!, "SEALED – Leak-proof and BPA free."], backendKeywords: "eco friendly lunch box" },
      { ...options, prohibitedClaims: ["leak proof"] },
    );
    expect(violations.map(({ rule, path, match }) => [rule, path, match])).toEqual([
      ["prohibited_claim", "bullets.1", "Leak-proof"],
      ["prohibited_claim", "backendKeywords", "eco friendly"],
    ]);
    for (const violation of violations) expect(ViolationSchema.parse(violation)).toEqual(violation);
  });

  it("checks the title policy", () => {
    const violations = checkListingCopy({ ...copy, title: "Lunch Box, Lunch Boxes, Box for Lunch?" }, options);
    expect(violations.map(({ rule, match }) => [rule, match])).toEqual([
      ["title_banned_character", "?"],
      ["title_word_repetition", "lunch"],
      ["title_word_repetition", "box"],
    ]);
  });

  it("checks the copy against the product type's schema as the attributes it is sent as", () => {
    const violations = checkListingCopy({ ...copy, bullets: [...copy.bullets, "ONE TOO MANY – Bullet."], backendKeywords: "kids ".repeat(30).trim() }, options);
    expect(violations.map(({ rule, keyword, path }) => [rule, keyword, path])).toEqual([
      ["attribute_schema", "maxItems", "/bullet_point"],
      ["attribute_schema", "maxUtf8ByteLength", "/generic_keyword/0/value"],
    ]);
  });

  it("still holds the values it sends to what their attribute requires", () => {
    const strict = { ...schema, properties: { ...schema.properties, item_name: { ...text({}), items: { ...text({}).items, required: ["value", "unit"] } } } };
    expect(checkListingCopy(copy, { ...options, productTypeSchema: strict }).map(({ keyword, path }) => [keyword, path])).toEqual([["required", "/item_name/0/unit"]]);
  });

  it("skips the schema when there is none", () => {
    expect(checkListingCopy({ ...copy, bullets: [...copy.bullets, "FOURTH – Fine without a schema."] }, { ...options, productTypeSchema: undefined })).toEqual([]);
  });
});

describe("listingAttributes", () => {
  it("sends each field as its attribute, leaving out empty ones", () => {
    const value = (text: string) => ({ value: text, language_tag: languageTag, marketplace_id: marketplaceId });
    expect(listingAttributes({ ...copy, description: "" }, { marketplaceId, languageTag })).toEqual({
      item_name: [value(copy.title)],
      bullet_point: copy.bullets.map(value),
      generic_keyword: [value(copy.backendKeywords)],
    });
  });
});

describe("listingLimits", () => {
  it("reads the product type's limits", () => {
    expect(listingLimits(schema)).toEqual({
      titleMaxLength: 150,
      bulletMaxCount: 3,
      bulletMaxLength: 300,
      descriptionMaxLength: 2000,
      backendKeywordsMaxBytes: 100,
    });
  });

  it("is never looser than Amazon's own limits or the category's title length", () => {
    const loose = { properties: { item_name: text({ maxLength: 500 }), bullet_point: { ...text({}), maxItems: 10 } } };
    expect(listingLimits(loose)).toEqual(LISTING_LIMITS);
    expect(listingLimits(loose, "BOOK", { lengthOverrides: { book: 80 } }).titleMaxLength).toBe(80);
    expect(listingLimits("not a schema")).toEqual(LISTING_LIMITS);
  });
});
