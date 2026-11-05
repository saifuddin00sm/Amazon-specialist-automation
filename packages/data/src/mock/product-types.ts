import { ProductTypeSchema, type ProductType, type ProductTypeAttribute, type ProductTypeSummary } from "@app/core";

/**
 * A stand-in for Amazon's Product Type Definitions API: a few product types per mock category, each
 * with the attributes a new listing must (required) and should (recommended) have. Both data sources
 * serve it until packages/amazon reads the real schemas; every marketplace sees the same types.
 */

type Entry = { definition: ProductType; keywords: readonly string[] };

const attribute = (
  name: string,
  label: string,
  description: string,
  requirement: ProductTypeAttribute["requirement"],
  rest: Partial<Pick<ProductTypeAttribute, "multiple" | "fromFact" | "draftable" | "options" | "maxLength">> = {},
): ProductTypeAttribute => ({ name, label, description, requirement, multiple: false, draftable: false, ...rest });

/** Something only the seller knows, typed into the wizard. */
const seller = (name: string, label: string, description: string, requirement: ProductTypeAttribute["requirement"], options?: string[]) =>
  attribute(name, label, description, requirement, options ? { options } : {});

const COUNTRIES = ["China", "India", "Vietnam", "Mexico", "United States", "Germany", "Italy", "Japan", "Taiwan", "Turkey"];
const YES_NO = ["Yes", "No"];
const COLOR = seller("color", "Color", "The color as shoppers see it, e.g. Sage Green.", "recommended");

/** Attributes every product type has, around the ones that set it apart. */
function definition(
  name: string,
  displayName: string,
  description: string,
  specific: ProductTypeAttribute[],
  { materialRequired = true }: { materialRequired?: boolean } = {},
): ProductType {
  return ProductTypeSchema.parse({
    name,
    displayName,
    description,
    attributes: [
      attribute("item_name", "Title", "The product title shoppers see in search results.", "required", { draftable: true, maxLength: 200 }),
      attribute("brand", "Brand", "The brand name printed on the product or its packaging.", "required", { fromFact: "brand" }),
      attribute("bullet_point", "Bullet points", "Up to five key features, one per bullet.", "required", { multiple: true, draftable: true, maxLength: 500 }),
      attribute("main_product_image_locator", "Main image", "The first image shoppers see: the product on a white background.", "required", {
        fromFact: "mainPhoto",
      }),
      seller("country_of_origin", "Country of origin", "Where the product was made.", "required", COUNTRIES),
      attribute("material", "Material", "What the product is made of.", materialRequired ? "required" : "recommended", { multiple: true, fromFact: "materials" }),
      ...specific,
      attribute("item_dimensions", "Item dimensions", "Length, width and height of the product, unpackaged.", "recommended", { fromFact: "dimensions" }),
      attribute("product_description", "Description", "A paragraph or two about the product.", "recommended", { draftable: true, maxLength: 2000 }),
      attribute("generic_keyword", "Search terms", "Hidden keywords shoppers search for, up to 249 bytes.", "recommended", { draftable: true }),
      attribute("item_type_keyword", "Item type keyword", "The browse node keyword that places the product in a category.", "recommended", { draftable: true }),
      attribute("other_product_image_locator", "Other images", "Up to eight more images: angles, details, the product in use.", "recommended", {
        multiple: true,
        fromFact: "otherPhotos",
      }),
      attribute("regulatory_compliance_certification", "Certifications", "Certifications the product holds, e.g. BPA free or CE marked.", "recommended", {
        multiple: true,
        fromFact: "certifications",
      }),
    ],
  });
}

const ENTRIES: readonly Entry[] = [
  {
    definition: definition("BOTTLE", "Water Bottle", "Reusable bottles and flasks for water and other drinks.", [
      seller("capacity", "Capacity", "How much it holds, e.g. 750 ml.", "required"),
      COLOR,
      seller("lid_type", "Lid type", "How the bottle closes.", "recommended", ["Screw cap", "Flip top", "Straw lid", "Chug cap"]),
      seller("is_dishwasher_safe", "Dishwasher safe", "Whether every part can go in a dishwasher.", "recommended", YES_NO),
    ]),
    keywords: ["water bottle", "bottle", "flask", "tumbler", "drinkware", "insulated", "travel mug", "kitchen"],
  },
  {
    definition: definition("CUTTING_BOARD", "Cutting Board", "Boards for cutting and serving food.", [
      seller("shape", "Shape", "The board's outline.", "recommended", ["Rectangular", "Round", "Square", "Oval"]),
      seller("is_dishwasher_safe", "Dishwasher safe", "Whether the board can go in a dishwasher.", "recommended", YES_NO),
      COLOR,
    ]),
    keywords: ["cutting board", "chopping board", "serving board", "butcher block", "kitchen"],
  },
  {
    definition: definition("KITCHEN_KNIFE", "Kitchen Knife", "Knives and knife sets for food preparation.", [
      seller("blade_length", "Blade length", "Length of the longest blade, e.g. 20 cm.", "required"),
      seller("number_of_pieces", "Number of pieces", "How many pieces come in the set.", "recommended"),
      seller("blade_edge", "Blade edge", "The cutting edge.", "recommended", ["Plain", "Serrated", "Hollow"]),
    ]),
    keywords: ["knife", "knife set", "chef knife", "kitchen knife", "cutlery", "kitchen"],
  },
  {
    definition: definition("HAMMOCK", "Hammock", "Camping and garden hammocks.", [
      seller("maximum_weight_recommendation", "Maximum weight", "The most weight it holds, e.g. 200 kg.", "required"),
      seller("number_of_people", "Number of people", "How many people it is made for.", "recommended", ["1", "2"]),
      COLOR,
    ]),
    keywords: ["hammock", "camping hammock", "outdoor", "camping", "garden"],
  },
  {
    definition: definition("EXERCISE_MAT", "Exercise Mat", "Yoga, pilates and floor exercise mats.", [
      seller("thickness", "Thickness", "How thick the mat is, e.g. 6 mm.", "required"),
      COLOR,
      seller("is_non_slip", "Non-slip", "Whether the surface is textured to stop slipping.", "recommended", YES_NO),
    ]),
    keywords: ["yoga mat", "exercise mat", "pilates", "fitness", "workout", "gym", "outdoors"],
  },
  {
    definition: definition("FLASHLIGHT", "Flashlight", "Flashlights, headlamps and lanterns.", [
      seller("brightness", "Brightness", "Light output, e.g. 400 lumens.", "required"),
      seller("power_source_type", "Power source", "What powers the light.", "required", ["Battery powered", "Rechargeable", "Solar powered"]),
      seller("batteries_included", "Batteries included", "Whether batteries come in the box.", "recommended", YES_NO),
    ]),
    keywords: ["flashlight", "headlamp", "torch", "lantern", "camping light", "outdoors"],
  },
  {
    definition: definition("PET_BED", "Pet Bed", "Beds, mats and cushions for pets.", [
      seller("target_species", "Pet type", "The animal it is made for.", "required", ["Dog", "Cat", "Small animal"]),
      seller("size", "Size", "The bed's size.", "required", ["Small", "Medium", "Large", "X-Large"]),
      COLOR,
    ]),
    keywords: ["pet bed", "dog bed", "cat bed", "pet cushion", "pets"],
  },
  {
    definition: definition(
      "PET_TOY",
      "Pet Toy",
      "Chew, fetch and puzzle toys for pets.",
      [
        seller("target_species", "Pet type", "The animal it is made for.", "required", ["Dog", "Cat", "Small animal"]),
        seller("size", "Size", "The toy's size.", "recommended", ["Small", "Medium", "Large"]),
      ],
      { materialRequired: false },
    ),
    keywords: ["pet toy", "dog toy", "cat toy", "chew toy", "fetch", "pets"],
  },
  {
    definition: definition("BLANKET", "Blanket", "Throws and bed blankets.", [
      seller("size", "Size", "The blanket's size.", "required", ["Throw", "Twin", "Queen", "King"]),
      COLOR,
      seller("pattern", "Pattern", "The blanket's pattern, e.g. Solid or Herringbone.", "recommended"),
    ]),
    keywords: ["blanket", "throw", "bedding", "home", "sofa"],
  },
  {
    definition: definition("CANDLE", "Candle", "Scented and unscented candles.", [
      seller("scent", "Scent", "The fragrance, e.g. Lavender. Unscented is a scent too.", "required"),
      seller("burn_time", "Burn time", "How long it burns, e.g. 40 hours.", "recommended"),
    ]),
    keywords: ["candle", "scented candle", "home fragrance", "home", "decor"],
  },
  {
    definition: definition("SKIN_MOISTURIZER", "Skin Moisturizer", "Face and body creams, lotions and balms.", [
      seller("skin_type", "Skin type", "The skin it is made for.", "required", ["All", "Dry", "Oily", "Combination", "Sensitive"]),
      seller("item_volume", "Volume", "How much is in the container, e.g. 50 ml.", "required"),
      seller("scent", "Scent", "The fragrance, or Unscented.", "recommended"),
    ]),
    keywords: ["moisturizer", "face cream", "lotion", "skin care", "beauty"],
  },
  {
    definition: definition("HAIR_BRUSH", "Hair Brush", "Brushes and combs for hair.", [
      seller("hair_type", "Hair type", "The hair it works best on.", "recommended", ["All", "Straight", "Wavy", "Curly", "Coily"]),
      COLOR,
    ]),
    keywords: ["hair brush", "brush", "comb", "detangler", "beauty"],
  },
  {
    definition: definition(
      "BUILDING_BLOCKS",
      "Building Blocks",
      "Construction sets and building bricks.",
      [
        seller("age_range_description", "Age range", "The youngest age it is safe for.", "required", ["1 year and up", "3 years and up", "6 years and up", "8 years and up"]),
        seller("number_of_pieces", "Number of pieces", "How many pieces come in the set.", "required"),
      ],
      { materialRequired: false },
    ),
    keywords: ["building blocks", "bricks", "construction set", "stem toy", "toys"],
  },
  {
    definition: definition(
      "PUZZLES",
      "Puzzle",
      "Jigsaw and 3D puzzles.",
      [
        seller("number_of_pieces", "Number of pieces", "How many pieces the puzzle has.", "required"),
        seller("age_range_description", "Age range", "The youngest age it is made for.", "required", ["3 years and up", "6 years and up", "8 years and up", "12 years and up"]),
      ],
      { materialRequired: false },
    ),
    keywords: ["puzzle", "jigsaw", "3d puzzle", "brain teaser", "toys"],
  },
];

const summary = ({ name, displayName, description }: ProductType): ProductTypeSummary => ({ name, displayName, description });

/**
 * Product types matching `keywords`, best match first, like Amazon's searchDefinitionsProductTypes.
 * A word in the name scores more than one in the description; no keywords lists every type.
 */
export function searchProductTypeCatalog(keywords = ""): ProductTypeSummary[] {
  const words = keywords.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return ENTRIES.map((entry) => summary(entry.definition)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const scored = ENTRIES.map((entry) => {
    const name = `${entry.definition.displayName} ${entry.definition.name.replaceAll("_", " ")}`.toLowerCase();
    const tags = entry.keywords.join(" ");
    const about = entry.definition.description.toLowerCase();
    const score = words.reduce((sum, word) => sum + (name.includes(word) ? 3 : tags.includes(word) ? 2 : about.includes(word) ? 1 : 0), 0);
    return { entry, score };
  });
  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.definition.displayName.localeCompare(b.entry.definition.displayName))
    .map(({ entry }) => summary(entry.definition));
}

/** One product type's schema, like Amazon's getDefinitionsProductType. */
export function productTypeDefinition(name: string): ProductType | undefined {
  return ENTRIES.find((entry) => entry.definition.name === name)?.definition;
}
