import { z } from "zod";
import type { ListingCopy } from "./compliance";
import type { DiffEntry } from "./proposal";

/**
 * A new_listing Proposal lists a product that isn't on Amazon yet, in one seller account. Its diff is
 * the brief the member gave in the New listing wizard, then one line per attribute the listing will
 * have, each set from nothing:
 *
 *   brief              null → NewListingBrief (product facts, product type, the seller's values)
 *   attributes.<name>  null → NewListingAttribute (the value and where it came from)
 */
export const newListingPath = {
  brief: "brief",
  attribute: (name: string) => `attributes.${name}`,
};

export const NEW_LISTING_LIMITS = {
  brandMaxLength: 50,
  productNameMaxLength: 150,
  materialsMax: 5,
  certificationsMax: 10,
  /** A main image and up to eight more. */
  photosMax: 9,
  /** Fewer than this gets a warning. */
  photosRecommended: 6,
  dimensionMaxCm: 500,
  /** Longest value a seller can type for an attribute without its own limit. */
  attributeMaxLength: 200,
} as const;

const dimension = (label: string) =>
  z
    .number({ error: `Enter the ${label} in cm.` })
    .positive(`The ${label} must be above 0 cm.`)
    .max(NEW_LISTING_LIMITS.dimensionMaxCm, `The ${label} can be at most ${NEW_LISTING_LIMITS.dimensionMaxCm} cm.`);

/** Ground truth a seller gives about a product that isn't listed yet. The listing agent may only claim what is in here. */
export const NewProductFactsSchema = z.object({
  brand: z.string().trim().min(1, "Enter the brand.").max(NEW_LISTING_LIMITS.brandMaxLength, `Keep the brand to ${NEW_LISTING_LIMITS.brandMaxLength} characters.`),
  productName: z
    .string()
    .trim()
    .min(1, "Enter the product name.")
    .max(NEW_LISTING_LIMITS.productNameMaxLength, `Keep the product name to ${NEW_LISTING_LIMITS.productNameMaxLength} characters.`),
  materials: z
    .array(z.string().trim().min(1).max(80, "Keep each material to 80 characters."))
    .min(1, "Add at least one material.")
    .max(NEW_LISTING_LIMITS.materialsMax, `Add at most ${NEW_LISTING_LIMITS.materialsMax} materials.`),
  dimensions: z.object({ lengthCm: dimension("length"), widthCm: dimension("width"), heightCm: dimension("height") }),
  /** Only what the seller can prove, e.g. "BPA free" with a lab report. Listing copy may claim nothing else. */
  certifications: z
    .array(z.string().trim().min(1).max(80, "Keep each certification to 80 characters."))
    .max(NEW_LISTING_LIMITS.certificationsMax, `Add at most ${NEW_LISTING_LIMITS.certificationsMax} certifications.`),
  /** Image URLs; the first is the main image. */
  photos: z
    .array(z.url({ protocol: /^https$/, error: "Use an https:// link to the image." }))
    .min(1, "Add the main photo.")
    .max(NEW_LISTING_LIMITS.photosMax, `Add at most ${NEW_LISTING_LIMITS.photosMax} photos.`),
});
export type NewProductFacts = z.infer<typeof NewProductFactsSchema>;

/** Amazon's product type name, e.g. "BOTTLE". */
export const ProductTypeNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

/** The product fact an attribute is filled from. */
export const ProductFactKeySchema = z.enum(["brand", "materials", "dimensions", "certifications", "mainPhoto", "otherPhotos"]);
export type ProductFactKey = z.infer<typeof ProductFactKeySchema>;

export const AttributeRequirementSchema = z.enum(["required", "recommended"]);
export type AttributeRequirement = z.infer<typeof AttributeRequirementSchema>;

/** One attribute in a product type's schema. */
export const ProductTypeAttributeSchema = z.object({
  /** Amazon's attribute name, e.g. "item_name". */
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  description: z.string().min(1),
  requirement: AttributeRequirementSchema,
  /** Takes several values (bullet points, materials) rather than one. */
  multiple: z.boolean(),
  /** The product fact that fills it, when one does. */
  fromFact: ProductFactKeySchema.optional(),
  /** Whether the listing agent may write it. Off for anything only the seller can know, like where it's made. */
  draftable: z.boolean(),
  /** The values Amazon accepts, for enumerated attributes. */
  options: z.array(z.string().min(1)).min(1).optional(),
  maxLength: z.number().int().positive().optional(),
});
export type ProductTypeAttribute = z.infer<typeof ProductTypeAttributeSchema>;

/** Attributes that hold the listing copy, by ListingCopy field. Every product type has them. */
export const LISTING_COPY_ATTRIBUTES = {
  title: "item_name",
  bullets: "bullet_point",
  description: "product_description",
  backendKeywords: "generic_keyword",
} as const;

/** Search results: which product type a product is, before its schema is loaded. */
export const ProductTypeSummarySchema = z.object({
  name: ProductTypeNameSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
});
export type ProductTypeSummary = z.infer<typeof ProductTypeSummarySchema>;

/** An Amazon product type and the attributes its listings take, as the Product Type Definitions API describes it. */
export const ProductTypeSchema = ProductTypeSummarySchema.extend({
  attributes: z.array(ProductTypeAttributeSchema).min(1),
}).superRefine((productType, ctx) => {
  const names = productType.attributes.map((attribute) => attribute.name);
  for (const name of Object.values(LISTING_COPY_ATTRIBUTES)) {
    if (!names.includes(name)) ctx.addIssue({ code: "custom", message: `Every product type needs ${name}`, path: ["attributes"] });
  }
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Attribute names must be unique", path: ["attributes"] });
  for (const [i, attribute] of productType.attributes.entries()) {
    // The seller types one value into the wizard for anything no fact fills and the agent can't write.
    if (!attribute.fromFact && !attribute.draftable && attribute.multiple) {
      ctx.addIssue({ code: "custom", message: "Seller-entered attributes take one value", path: ["attributes", i, "multiple"] });
    }
  }
});
export type ProductType = z.infer<typeof ProductTypeSchema>;

/** What the member gave the listing creator in the New listing wizard. */
export const NewListingBriefSchema = z.object({
  productType: ProductTypeNameSchema,
  facts: NewProductFactsSchema,
  /** Values the seller entered for attributes no fact fills and the agent may not draft, by attribute name. */
  attributes: z.record(z.string(), z.string().trim().min(1)),
});
export type NewListingBrief = z.infer<typeof NewListingBriefSchema>;

/** One attribute's value: text, or a list for attributes that take several. */
export const AttributeValueSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

export const AttributeSourceSchema = z.enum(["facts", "seller", "agent"]);
export type AttributeSource = z.infer<typeof AttributeSourceSchema>;

/** One attribute of the listing a new_listing proposal would create. */
export const NewListingAttributeSchema = z.object({ value: AttributeValueSchema, source: AttributeSourceSchema });
export type NewListingAttribute = z.infer<typeof NewListingAttributeSchema>;

/**
 * Who fills each attribute: a product fact, the seller in the wizard, or the agent. `missing` is a
 * required attribute nobody can fill yet; `empty` a recommended one left out.
 */
export type AttributePlanStatus = AttributeSource | "missing" | "empty";

export type AttributePlan = { attribute: ProductTypeAttribute; status: AttributePlanStatus; value?: AttributeValue };

/** Attributes the seller types a value for: no fact fills them and the agent may not draft them. */
export function sellerAttributes(productType: ProductType): ProductTypeAttribute[] {
  return productType.attributes.filter((attribute) => !attribute.fromFact && !attribute.draftable);
}

/** "30 × 8 × 8 cm" */
export function formatDimensions({ lengthCm, widthCm, heightCm }: NewProductFacts["dimensions"]): string {
  return `${lengthCm} × ${widthCm} × ${heightCm} cm`;
}

/** The value a product fact gives an attribute, if the seller gave that fact. */
export function factValue(facts: NewProductFacts, key: ProductFactKey): AttributeValue | undefined {
  switch (key) {
    case "brand":
      return facts.brand;
    case "materials":
      return facts.materials;
    case "dimensions":
      return formatDimensions(facts.dimensions);
    case "certifications":
      return facts.certifications.length > 0 ? facts.certifications : undefined;
    case "mainPhoto":
      return facts.photos[0];
    case "otherPhotos":
      return facts.photos.length > 1 ? facts.photos.slice(1) : undefined;
  }
}

/** Who fills each of the product type's attributes, in the schema's order. */
export function planNewListingAttributes(
  productType: ProductType,
  facts: NewProductFacts,
  sellerValues: Readonly<Record<string, string | undefined>>,
): AttributePlan[] {
  return productType.attributes.map((attribute): AttributePlan => {
    if (attribute.fromFact) {
      const value = factValue(facts, attribute.fromFact);
      if (value !== undefined) return { attribute, status: "facts", value };
    } else if (attribute.draftable) {
      return { attribute, status: "agent" };
    } else {
      const value = sellerValues[attribute.name]?.trim();
      if (value) return { attribute, status: "seller", value };
    }
    return { attribute, status: attribute.requirement === "required" ? "missing" : "empty" };
  });
}

/**
 * Zod for the wizard's last step: the seller's values for the product type's seller attributes.
 * Required ones must be set and enumerated ones must be one of Amazon's options; nothing else is allowed.
 */
export function sellerAttributesSchema(productType: ProductType) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const attribute of sellerAttributes(productType)) {
    const max = attribute.maxLength ?? NEW_LISTING_LIMITS.attributeMaxLength;
    const value = attribute.options
      ? z.enum(attribute.options as [string, ...string[]], { error: `Pick a ${attribute.label.toLowerCase()}.` })
      : z
          .string({ error: `Enter the ${attribute.label.toLowerCase()}.` })
          .trim()
          .min(1, `Enter the ${attribute.label.toLowerCase()}.`)
          .max(max, `Keep the ${attribute.label.toLowerCase()} to ${max} characters.`);
    shape[attribute.name] = attribute.requirement === "required" ? value : value.optional();
  }
  return z.strictObject(shape);
}

/** Why a brief doesn't fit its product type, or undefined when it does. */
export function newListingBriefProblem(brief: NewListingBrief, productType: ProductType): string | undefined {
  if (brief.productType !== productType.name) return `The brief is for ${brief.productType}, not ${productType.name}.`;
  const parsed = sellerAttributesSchema(productType).safeParse(brief.attributes);
  if (parsed.success) return undefined;
  const [issue] = parsed.error.issues;
  return issue?.code === "unrecognized_keys" ? `${productType.displayName} has no attribute ${issue.keys.join(", ")}.` : issue?.message;
}

/** The diff of a new_listing proposal: the brief, then each attribute that has a value. */
export function newListingDiff(brief: NewListingBrief, attributes: readonly { name: string; attribute: NewListingAttribute }[]): DiffEntry[] {
  return [
    { path: newListingPath.brief, before: null, after: brief },
    ...attributes.map(({ name, attribute }) => ({ path: newListingPath.attribute(name), before: null, after: attribute })),
  ];
}

/** Reads a new_listing diff. Lines that aren't the brief or an attribute land in `unreadable`. */
export function parseNewListing(diff: readonly DiffEntry[]): {
  brief: NewListingBrief | undefined;
  /** By attribute name, in the diff's order. */
  attributes: Map<string, NewListingAttribute>;
  unreadable: DiffEntry[];
} {
  let brief: NewListingBrief | undefined;
  const attributes = new Map<string, NewListingAttribute>();
  const unreadable: DiffEntry[] = [];
  for (const entry of diff) {
    const name = /^attributes\.([a-z][a-z0-9_]*)$/.exec(entry.path)?.[1];
    if (entry.before !== null) {
      unreadable.push(entry);
    } else if (entry.path === newListingPath.brief) {
      const parsed = NewListingBriefSchema.safeParse(entry.after);
      if (parsed.success && !brief) brief = parsed.data;
      else unreadable.push(entry);
    } else if (name && !attributes.has(name)) {
      const parsed = NewListingAttributeSchema.safeParse(entry.after);
      if (parsed.success) attributes.set(name, parsed.data);
      else unreadable.push(entry);
    } else {
      unreadable.push(entry);
    }
  }
  return { brief, attributes, unreadable };
}

/** The listing copy held in a new listing's attributes; missing ones are empty. */
export function newListingCopy(attributes: ReadonlyMap<string, NewListingAttribute>): ListingCopy {
  const text = (name: string) => {
    const value = attributes.get(name)?.value;
    return Array.isArray(value) ? value.join(" ") : (value ?? "");
  };
  const bullets = attributes.get(LISTING_COPY_ATTRIBUTES.bullets)?.value;
  return {
    title: text(LISTING_COPY_ATTRIBUTES.title),
    bullets: Array.isArray(bullets) ? bullets : bullets ? [bullets] : [],
    description: text(LISTING_COPY_ATTRIBUTES.description),
    backendKeywords: text(LISTING_COPY_ATTRIBUTES.backendKeywords),
  };
}

/** "Acme Water Bottle", without saying the brand twice when the name already starts with it. */
export function newListingName({ brand, productName }: Pick<NewProductFacts, "brand" | "productName">): string {
  return productName.toLowerCase().startsWith(brand.toLowerCase()) ? productName : `${brand} ${productName}`;
}
