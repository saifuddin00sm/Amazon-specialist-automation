import { ProductFactsSchema, type ListingCopy, type ProductFacts } from "@app/core";

/**
 * The listing optimizer's test products. Each one tempts the writer toward something the guard
 * rejects: a keyword that is a prohibited claim, a brand with a banned character, a product name
 * that invites repeated words, a live listing that already breaks the rules, a tighter title limit.
 * They are fixed here, not drawn from the mock dataset, so the bar measures the same ten every time.
 */
export type ListingOptimizerCase = {
  name: string;
  brand: string;
  productType: string;
  productTypeSchema: unknown;
  facts: ProductFacts;
  keywords: string[];
  live: ListingCopy;
};

export const EVAL_MARKETPLACE_ID = "ATVPDKIKX0DER";
export const EVAL_LANGUAGE_TAG = "en_US";

const text = (limits: Record<string, number>) => ({
  type: "array",
  items: {
    type: "object",
    required: ["value", "marketplace_id"],
    additionalProperties: false,
    properties: { value: { type: "string", minLength: 1, ...limits }, language_tag: { type: "string" }, marketplace_id: { type: "string" } },
  },
});

/** A product type schema in the shape getDefinitionsProductType links to, cut down to what a listing update touches. */
function productTypeSchema(productType: string, { titleMaxLength = 200 }: { titleMaxLength?: number } = {}) {
  return {
    $schema: "https://schemas.amazon.com/selling-partners/definitions/product-types/meta-schema/v1",
    $id: `https://schemas.amazon.com/selling-partners/definitions/product-types/schema/v1/${productType}`,
    type: "object",
    required: ["item_name", "brand", "bullet_point"],
    additionalProperties: false,
    properties: {
      item_name: { ...text({ maxLength: titleMaxLength, maxUtf8ByteLength: titleMaxLength * 2 }), minItems: 1, maxUniqueItems: 1, editable: true },
      brand: text({ maxLength: 100 }),
      bullet_point: { ...text({ maxLength: 500, maxUtf8ByteLength: 1000 }), minItems: 1, maxItems: 5 },
      product_description: { ...text({ maxLength: 2000, maxUtf8ByteLength: 4000 }), maxItems: 1 },
      generic_keyword: { ...text({ maxUtf8ByteLength: 249 }), maxItems: 1 },
      color: text({ maxLength: 50 }),
      material: text({ maxLength: 100 }),
    },
  };
}

type CaseInput = Omit<ListingOptimizerCase, "productTypeSchema" | "facts"> & {
  titleMaxLength?: number;
  facts: Omit<ProductFacts, "productId" | "updatedAt" | "targetKeywords">;
};

function testCase({ titleMaxLength, facts, ...rest }: CaseInput): ListingOptimizerCase {
  return {
    ...rest,
    productTypeSchema: productTypeSchema(rest.productType, { titleMaxLength }),
    facts: ProductFactsSchema.parse({
      ...facts,
      productId: `eval_${rest.name}`,
      targetKeywords: rest.keywords,
      updatedAt: "2026-11-01T00:00:00.000Z",
    }),
  };
}

export const LISTING_OPTIMIZER_CASES: readonly ListingOptimizerCase[] = [
  testCase({
    name: "water-bottle",
    brand: "Northlane",
    productType: "BOTTLE",
    keywords: ["insulated water bottle", "bpa free water bottle", "leak proof water bottle", "stainless steel water bottle 32 oz", "gym water bottle"],
    facts: {
      material: "18/8 stainless steel",
      color: "Sage Green",
      dimensions: { lengthCm: 9.5, widthCm: 9.5, heightCm: 27 },
      weightGrams: 480,
      includedComponents: ["1 x 32 oz bottle", "1 x straw lid", "1 x cleaning brush"],
      features: [
        "Double-wall vacuum insulation keeps drinks cold for 24 hours and hot for 12.",
        "Holds 32 oz (946 ml).",
        "The straw lid has a carry loop.",
        "Powder-coated finish for a firm grip.",
        "Fits most car cup holders.",
      ],
      prohibitedClaims: ["BPA free", "leak proof", "leakproof"],
    },
    live: {
      title: "Northlane Water Bottle, Green",
      bullets: ["Keeps drinks cold for 24 hours.", "Holds 32 oz."],
      description: "The Northlane water bottle in sage green.",
      backendKeywords: "bottle flask",
    },
  }),
  testCase({
    name: "cutting-board",
    brand: "Oak & Ember",
    productType: "CUTTING_BOARD",
    keywords: ["bamboo cutting board", "antibacterial cutting board", "eco friendly cutting board", "large cutting board with juice groove", "cutting boards for kitchen"],
    facts: {
      material: "Moso bamboo",
      color: "Natural",
      dimensions: { lengthCm: 45, widthCm: 30, heightCm: 2 },
      weightGrams: 1600,
      includedComponents: ["1 x cutting board"],
      features: [
        "A deep juice groove runs around the edge.",
        "Side handles cut into both ends.",
        "Reversible: a flat side for bread and a grooved side for meat.",
        "Hand wash and oil now and then.",
      ],
      prohibitedClaims: ["antibacterial", "sustainable", "dishwasher safe"],
    },
    live: {
      title: "Oak & Ember Eco-Friendly Bamboo Cutting Board",
      bullets: ["Large bamboo board.", "Juice groove.", "Handles on both ends."],
      description: "An eco-friendly board for every kitchen.",
      backendKeywords: "chopping board wood",
    },
  }),
  testCase({
    name: "yoga-mat",
    brand: "Stillwater",
    productType: "EXERCISE_MAT",
    keywords: ["non toxic yoga mat", "thick yoga mat", "yoga mat for women", "non slip exercise mat", "eco friendly yoga mat"],
    facts: {
      material: "TPE foam",
      color: "Dusty Rose",
      dimensions: { lengthCm: 183, widthCm: 61, heightCm: 0.8 },
      weightGrams: 1100,
      includedComponents: ["1 x yoga mat", "1 x carry strap"],
      features: [
        "8 mm thick cushioning for knees and wrists.",
        "A textured surface on both sides grips the floor and your hands.",
        "Alignment lines printed across the top.",
        "Wipes clean with a damp cloth.",
      ],
      prohibitedClaims: ["non-toxic", "latex free", "odorless"],
    },
    live: {
      title: "Stillwater Yoga Mat",
      bullets: ["8 mm thick.", "Non-slip texture."],
      description: "A thick mat for yoga and pilates.",
      backendKeywords: "pilates mat",
    },
  }),
  testCase({
    name: "dog-shampoo",
    brand: "Muddy Paws",
    productType: "PET_SUPPLIES",
    titleMaxLength: 150,
    keywords: ["dog shampoo for itchy skin", "flea shampoo for dogs", "oatmeal dog shampoo", "puppy shampoo", "dog shampoo and conditioner"],
    facts: {
      material: "Colloidal oatmeal and aloe vera formula",
      color: "Cream",
      dimensions: { lengthCm: 7, widthCm: 5, heightCm: 20 },
      weightGrams: 520,
      includedComponents: ["1 x 16 fl oz bottle of shampoo"],
      features: [
        "Made with colloidal oatmeal and aloe vera.",
        "Lightly scented with coconut.",
        "Lathers quickly and rinses out clean.",
        "For dogs and puppies over 12 weeks old.",
      ],
      prohibitedClaims: ["kills fleas", "flea", "relieves itching", "vet recommended", "hypoallergenic"],
    },
    live: {
      title: "Muddy Paws Oatmeal Dog Shampoo",
      bullets: ["Oatmeal and aloe.", "Coconut scent."],
      description: "Shampoo for dogs.",
      backendKeywords: "pet wash",
    },
  }),
  testCase({
    name: "silicone-utensils",
    brand: "Kettle & Pine",
    productType: "KITCHEN_UTENSIL_SET",
    keywords: ["silicone cooking utensils set", "fda approved silicone utensils", "heat resistant spatula set", "non stick cooking utensils", "kitchen utensil set 12 piece"],
    facts: {
      material: "Silicone heads on stainless steel cores",
      color: "Black",
      dimensions: { lengthCm: 34, widthCm: 12, heightCm: 8 },
      weightGrams: 1250,
      includedComponents: ["1 x solid spoon", "1 x slotted spoon", "1 x turner", "1 x spatula", "1 x ladle", "1 x tongs", "1 x whisk", "1 x utensil holder"],
      features: [
        "Silicone heads rated to 230 °C (446 °F).",
        "Soft edges won't scratch non-stick pans.",
        "Stainless steel cores keep the handles from bending.",
        "Every piece hangs from a loop in its handle.",
      ],
      prohibitedClaims: ["food grade", "BPA free", "dishwasher safe"],
    },
    live: {
      title: "Kettle & Pine Kitchen Utensils Set, Silicone Utensils, Utensils Holder",
      bullets: ["Heat resistant to 446 F.", "Safe for non-stick pans.", "Comes with a holder."],
      description: "A complete set of silicone utensils.",
      backendKeywords: "spatula ladle tongs",
    },
  }),
  testCase({
    name: "lunch-box",
    brand: "Yay! Kids",
    productType: "LUNCH_BOX",
    keywords: ["kids lunch box", "bento box for kids", "lunch containers for kids", "leak proof lunch box", "toddler lunch box"],
    facts: {
      material: "Polypropylene with a silicone seal",
      color: "Ocean Blue",
      dimensions: { lengthCm: 22, widthCm: 17, heightCm: 5.5 },
      weightGrams: 410,
      includedComponents: ["1 x bento box", "1 x removable divider", "1 x mini sauce cup"],
      features: [
        "Four compartments keep foods apart.",
        "The silicone seal clips shut with one latch a child can open.",
        "The divider lifts out for bigger meals.",
        "Top-rack dishwasher safe.",
      ],
      prohibitedClaims: ["leak proof", "BPA free", "lead free"],
    },
    live: {
      title: "Yay! Kids Bento Lunch Box, Blue",
      bullets: ["4 compartments.", "Easy-open latch.", "Dishwasher safe."],
      description: "A bento box for school lunches.",
      backendKeywords: "school lunch",
    },
  }),
  testCase({
    name: "phone-case",
    brand: "Ridgeback",
    productType: "CELLULAR_PHONE_CASE",
    keywords: ["iphone 16 case", "best seller iphone case", "military grade drop protection case", "clear iphone case with magsafe", "shockproof phone case"],
    facts: {
      material: "Polycarbonate back with TPU bumpers",
      color: "Clear",
      dimensions: { lengthCm: 15.5, widthCm: 7.8, heightCm: 1.2 },
      weightGrams: 38,
      includedComponents: ["1 x phone case"],
      features: [
        "Fits iPhone 16 only.",
        "A built-in magnet ring works with MagSafe chargers and mounts.",
        "Raised edges around the screen and camera.",
        "Air-cushioned corners.",
        "A yellowing-resistant coating on the clear back.",
      ],
      prohibitedClaims: ["military grade", "drop proof", "shockproof", "never yellows"],
    },
    live: {
      title: "Ridgeback Clear Case for iPhone 16 - #1 Best Seller",
      bullets: ["MagSafe compatible.", "Raised edges."],
      description: "A clear case for iPhone 16.",
      backendKeywords: "cover",
    },
  }),
  testCase({
    name: "trash-bags",
    brand: "Greenfold",
    productType: "TRASH_BAG",
    keywords: ["compostable trash bags", "biodegradable trash bags", "13 gallon trash bags", "kitchen trash bags", "eco friendly garbage bags"],
    facts: {
      material: "Plant-based PBAT and corn starch film",
      color: "Green",
      dimensions: { lengthCm: 60, widthCm: 76, heightCm: 0.002 },
      weightGrams: 900,
      includedComponents: ["50 x 13 gallon bags", "1 x roll box"],
      features: [
        "Certified compostable to ASTM D6400 in industrial composting facilities.",
        "Fits 13 gallon (49 litre) kitchen bins.",
        "Drawstring top ties shut.",
        "Bags tear off the roll one at a time.",
      ],
      prohibitedClaims: ["home compostable", "plastic free", "zero waste"],
    },
    live: {
      title: "Greenfold Biodegradable Trash Bags 13 Gallon",
      bullets: ["Compostable.", "Drawstring.", "50 bags."],
      description: "Biodegradable bags for your kitchen bin.",
      backendKeywords: "garbage bags bin liners",
    },
  }),
  testCase({
    name: "hand-cream",
    brand: "Briar Lane",
    productType: "SKIN_MOISTURIZER",
    keywords: ["hand cream for very dry cracked hands", "eczema hand cream", "healing hand cream", "shea butter hand cream", "hand lotion travel size"],
    facts: {
      material: "Shea butter and glycerin cream",
      color: "White",
      dimensions: { lengthCm: 3.5, widthCm: 5, heightCm: 14 },
      weightGrams: 85,
      includedComponents: ["1 x 2.5 oz tube"],
      features: [
        "Made with 20% shea butter and glycerin.",
        "Absorbs in about a minute without a greasy feel.",
        "Unscented.",
        "A 2.5 oz tube that fits a bag or pocket.",
      ],
      prohibitedClaims: ["eczema", "dermatologist recommended", "hypoallergenic", "repairs skin"],
    },
    live: {
      title: "Briar Lane Hand Cream for Dry Hands - Heals Cracked Hands",
      bullets: ["Shea butter.", "Unscented."],
      description: "Hand cream for dry hands.",
      backendKeywords: "lotion moisturizer",
    },
  }),
  testCase({
    name: "led-desk-lamp",
    brand: "Lumora",
    productType: "LAMP",
    keywords: ["led desk lamp", "desk lamp with usb charging port", "eye caring desk lamp", "dimmable desk lamp for home office", "reading lamp"],
    facts: {
      material: "Aluminum alloy and ABS",
      color: "Matte Black",
      dimensions: { lengthCm: 40, widthCm: 16, heightCm: 45 },
      weightGrams: 1300,
      includedComponents: ["1 x desk lamp", "1 x 12V power adapter", "1 x quick start guide"],
      features: [
        "Five color temperatures from 2700 K to 6500 K.",
        "Seven brightness levels on a touch panel.",
        "A USB-A port on the base charges a phone at 5V/1A.",
        "The arm folds and the head turns 180°.",
        "A 45-minute auto-off timer.",
      ],
      prohibitedClaims: ["eye caring", "eye protection", "reduces eye strain", "flicker free", "UL listed"],
    },
    live: {
      title: "Lumora LED Desk Lamp",
      bullets: ["5 color modes.", "USB port.", "Foldable."],
      description: "A desk lamp for work and study.",
      backendKeywords: "light office",
    },
  }),
];
