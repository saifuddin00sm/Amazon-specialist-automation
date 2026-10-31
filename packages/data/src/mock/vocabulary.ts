/** Word lists that make generated catalogs read like real Amazon listings. */
export type CategoryVocabulary = {
  name: string;
  /** Short label for campaign names. */
  short: string;
  code: string;
  nouns: readonly string[];
  adjectives: readonly string[];
  materials: readonly string[];
  colors: readonly string[];
  /** [headline, sentence] pairs used for bullets and facts. */
  features: readonly (readonly [string, string])[];
  components: readonly string[];
  keywords: readonly string[];
  useCases: readonly string[];
  prohibitedClaims: readonly string[];
  priceRange: readonly [number, number];
  weightGramsRange: readonly [number, number];
  sizeCmRange: readonly [number, number];
};

export const CATEGORIES = {
  kitchen: {
    name: "Kitchen & Dining",
    short: "Kitchen",
    code: "KIT",
    nouns: ["Water Bottle", "Coffee Tumbler", "Lunch Box", "Cutting Board", "Knife Set", "Mixing Bowl Set", "Spice Rack", "French Press"],
    adjectives: ["Insulated", "Leakproof", "Premium", "Compact", "Durable"],
    materials: ["18/8 Stainless Steel", "Bamboo", "Borosilicate Glass", "Tritan Plastic"],
    colors: ["Matte Black", "Sage Green", "Ocean Blue", "Stone Gray", "Cream"],
    features: [
      ["EASY TO CLEAN", "Dishwasher-safe parts come apart in seconds."],
      ["BUILT TO LAST", "Reinforced construction resists dents and daily wear."],
      ["LEAKPROOF SEAL", "A silicone gasket keeps liquids where they belong."],
      ["TEMPERATURE CONTROL", "Double-wall design keeps drinks cold for 24 hours or hot for 12."],
      ["SPACE SAVING", "Nests neatly in cabinets and drawers."],
      ["GIFT READY", "Arrives in a recyclable gift box."],
      ["COMFORT GRIP", "A contoured handle sits securely in hand."],
      ["FOOD SAFE", "Made with food-grade materials."],
    ],
    components: ["Carry handle", "Cleaning brush", "Spare gasket", "Storage pouch", "Quick-start guide"],
    keywords: ["insulated bottle", "reusable water bottle", "kitchen gift", "meal prep", "travel mug", "dishwasher safe", "stainless steel", "office lunch"],
    useCases: ["gym", "office", "travel", "school"],
    prohibitedClaims: ["BPA free", "Keeps drinks cold for 48 hours", "FDA approved"],
    priceRange: [12, 59],
    weightGramsRange: [150, 1800],
    sizeCmRange: [8, 45],
  },
  outdoors: {
    name: "Sports & Outdoors",
    short: "Outdoors",
    code: "OUT",
    nouns: ["Camping Hammock", "Trekking Poles", "Yoga Mat", "Resistance Bands", "Dry Bag", "Headlamp", "Foam Roller", "Hydration Pack"],
    adjectives: ["Lightweight", "Ultralight", "Waterproof", "Adjustable", "Heavy-Duty"],
    materials: ["Ripstop Nylon", "Aircraft-Grade Aluminum", "TPE Foam", "Natural Latex"],
    colors: ["Forest Green", "Slate", "Burnt Orange", "Charcoal", "Sky Blue"],
    features: [
      ["PACKS SMALL", "Folds down to fit a daypack side pocket."],
      ["ALL-WEATHER", "Sealed seams shed rain and morning dew."],
      ["ADJUSTABLE FIT", "Quick-release buckles dial in the right fit."],
      ["NON-SLIP", "Textured surface grips on wet or dusty ground."],
      ["QUICK SETUP", "Ready to use in under two minutes."],
      ["REFLECTIVE DETAILS", "Reflective trim adds visibility at dusk."],
      ["VERSATILE", "Works for trail days, travel, and home workouts."],
      ["EASY CARE", "Rinse with water and air dry."],
    ],
    components: ["Stuff sack", "Carabiners", "Tree straps", "Carry strap", "Exercise guide"],
    keywords: ["camping gear", "hiking accessories", "home gym", "outdoor gifts", "backpacking", "workout equipment", "travel gear", "fitness"],
    useCases: ["camping", "hiking", "home workouts", "travel"],
    prohibitedClaims: ["Military grade", "Lifetime guarantee", "Doctor recommended"],
    priceRange: [15, 89],
    weightGramsRange: [90, 2200],
    sizeCmRange: [10, 180],
  },
  pets: {
    name: "Pet Supplies",
    short: "Pets",
    code: "PET",
    nouns: ["Dog Leash", "Cat Scratching Post", "Pet Water Fountain", "Dog Chew Toy", "Pet Grooming Brush", "Slow Feeder Bowl", "Dog Bed", "Cat Litter Mat"],
    adjectives: ["Chew-Resistant", "Washable", "Orthopedic", "Non-Slip", "Calming"],
    materials: ["Reflective Nylon", "Natural Rubber", "Memory Foam", "Sisal Rope"],
    colors: ["Coral", "Navy", "Mocha", "Mint", "Heather Gray"],
    features: [
      ["MACHINE WASHABLE", "Removable cover goes straight in the wash."],
      ["STAYS PUT", "A rubber base keeps it from sliding on hard floors."],
      ["GENTLE ON PAWS", "Rounded edges and soft materials are kind to paws."],
      ["SLOWS FAST EATERS", "Raised ridges turn mealtime into a puzzle."],
      ["EASY GROOMING", "One-click release clears collected fur."],
      ["NIGHT VISIBILITY", "Reflective stitching shows up in headlights."],
      ["SIZED RIGHT", "Available in sizes for small to large breeds."],
      ["QUIET OPERATION", "Runs quietly enough for bedrooms."],
    ],
    components: ["Spare filter", "Waste bag dispenser", "Cleaning brush", "Sizing guide"],
    keywords: ["dog supplies", "cat accessories", "puppy essentials", "pet gifts", "large dogs", "small breeds", "indoor cats", "pet grooming"],
    useCases: ["puppies", "large dogs", "senior pets", "indoor cats"],
    prohibitedClaims: ["Vet approved", "Indestructible", "Cures anxiety"],
    priceRange: [9, 79],
    weightGramsRange: [80, 4500],
    sizeCmRange: [10, 110],
  },
  home: {
    name: "Home Storage & Organization",
    short: "Storage",
    code: "HOM",
    nouns: ["Drawer Organizer", "Storage Bins", "Closet Shelf Divider", "Under-Bed Storage Bag", "Cable Management Box", "Shoe Rack", "Over-Door Organizer", "Vacuum Storage Bags"],
    adjectives: ["Stackable", "Collapsible", "Clear", "Modular", "Space-Saving"],
    materials: ["Linen Fabric", "Recycled Plastic", "Powder-Coated Steel", "Acrylic"],
    colors: ["White", "Oatmeal", "Black", "Taupe", "Clear"],
    features: [
      ["STACKS SECURELY", "Interlocking rims keep stacks steady."],
      ["FOLDS FLAT", "Collapses flat when not in use."],
      ["SEE WHAT'S INSIDE", "Clear front panel shows contents at a glance."],
      ["REINFORCED HANDLES", "Stitched handles make lifting easy."],
      ["TOOL-FREE ASSEMBLY", "Snaps together without tools."],
      ["MIX AND MATCH", "Modular sizes combine to fit any shelf."],
      ["DUST CONTROL", "A fitted lid keeps dust out."],
      ["LABEL READY", "Built-in label slot for quick sorting."],
    ],
    components: ["Lids", "Label cards", "Dividers", "Mounting hardware"],
    keywords: ["closet organization", "storage containers", "home organization", "pantry storage", "small spaces", "dorm essentials", "garage storage", "declutter"],
    useCases: ["closet", "pantry", "dorm room", "garage"],
    prohibitedClaims: ["Holds up to 200 lbs", "Mold proof", "Eco-certified"],
    priceRange: [11, 64],
    weightGramsRange: [200, 6000],
    sizeCmRange: [15, 120],
  },
  beauty: {
    name: "Beauty & Personal Care",
    short: "Beauty",
    code: "BEA",
    nouns: ["Jade Roller", "Makeup Brush Set", "Hair Dryer Brush", "Silk Pillowcase", "Vanity Mirror", "Electric Toothbrush", "Scalp Massager", "Travel Toiletry Bag"],
    adjectives: ["Gentle", "Professional", "Rechargeable", "Travel-Size", "Soft-Touch"],
    materials: ["Mulberry Silk", "Synthetic Bristles", "Rose Quartz", "Vegan Leather"],
    colors: ["Blush Pink", "Champagne", "Ivory", "Lavender", "Black"],
    features: [
      ["SALON FEEL", "Delivers a salon-style finish at home."],
      ["TRAVEL FRIENDLY", "Slim profile fits carry-on bags."],
      ["USB-C CHARGING", "Charges fully in about two hours."],
      ["SOFT ON SKIN", "Smooth edges glide without tugging."],
      ["EASY TO CLEAN", "Wipes clean with warm water."],
      ["GIFT READY", "Packaged in a keepsake box."],
      ["EVEN LIGHT", "Diffused LEDs light the face evenly."],
      ["ORGANIZED", "Interior pockets keep essentials sorted."],
    ],
    components: ["Charging cable", "Storage pouch", "Cleaning cloth", "Replacement head"],
    keywords: ["skincare tools", "beauty gifts", "self care", "travel beauty", "hair care", "makeup tools", "spa at home", "grooming kit"],
    useCases: ["travel", "daily routine", "sensitive skin", "gifting"],
    prohibitedClaims: ["Dermatologist tested", "Clinically proven", "Hypoallergenic"],
    priceRange: [10, 99],
    weightGramsRange: [40, 900],
    sizeCmRange: [5, 50],
  },
  toys: {
    name: "Toys & Games",
    short: "Toys",
    code: "TOY",
    nouns: ["Building Blocks Set", "Wooden Puzzle", "Card Game", "Magnetic Tiles", "Plush Toy", "STEM Kit", "Kids Art Set", "Ring Toss Game"],
    adjectives: ["Educational", "Colorful", "Family-Friendly", "Creative", "Classic"],
    materials: ["Sustainable Wood", "ABS Plastic", "Soft Polyester", "Recycled Cardboard"],
    colors: ["Rainbow", "Primary Colors", "Pastel", "Natural Wood", "Bright Mix"],
    features: [
      ["HOURS OF PLAY", "Open-ended pieces invite new builds every day."],
      ["LEARN THROUGH PLAY", "Builds fine motor skills and spatial thinking."],
      ["FAMILY FUN", "Rules take two minutes to learn."],
      ["STURDY PIECES", "Thick parts stand up to enthusiastic play."],
      ["EASY CLEANUP", "Includes a storage bag for quick tidying."],
      ["GIFT READY", "Bright packaging ready for birthdays."],
      ["SCREEN-FREE", "Hands-on play away from screens."],
      ["CLEAR GUIDE", "Illustrated guide with starter ideas."],
    ],
    components: ["Storage bag", "Idea booklet", "Spare pieces", "Score pad"],
    keywords: ["kids gifts", "educational toys", "family games", "toddler toys", "birthday gift", "stem toys", "rainy day activities", "party games"],
    useCases: ["toddlers", "family game night", "birthday gifts", "classrooms"],
    prohibitedClaims: ["Non-toxic", "Award-winning", "Safe for all ages"],
    priceRange: [8, 69],
    weightGramsRange: [100, 2500],
    sizeCmRange: [10, 60],
  },
} as const satisfies Record<string, CategoryVocabulary>;

export type CategoryKey = keyof typeof CATEGORIES;

export const BRAND_PREFIXES = ["Bright", "Pure", "Trail", "North", "Urban", "Cedar", "Lumen", "Hearth", "Summit", "Willow", "Kinetic", "Oak", "Harbor", "Fern", "Atlas"] as const;
export const BRAND_SUFFIXES = ["wise", "crest", "line", "craft", "nest", "field", "works", "peak", "haven", "lane"] as const;

export const AGENCY_NAMES = ["Shelfwise Digital", "Marketlift Partners", "Brightcart Commerce", "Sellsmith Growth", "Northstar Marketplace Group"] as const;

/** Search terms that waste spend; used for negative keyword proposals. */
export const NEGATIVE_MODIFIERS = ["free", "used", "cheap", "diy", "replacement parts", "repair"] as const;

export const REJECTION_NOTES = [
  "Doesn't match our brand voice.",
  "Hold until the current promotion ends.",
  "Keep this as is; it drives organic rank.",
  "Budget is fixed for this quarter.",
  "Not convinced by the data yet; revisit next week.",
] as const;

export const RUN_ERRORS = [
  "Amazon Ads API rate limit exceeded (429)",
  "SP-API token expired; reconnect the seller account",
  "Timed out waiting for report generation",
] as const;

/** Keyword ideas for a product type, used for targets and facts. */
export function keywordIdeas(vocabulary: CategoryVocabulary, noun: string, adjective: string): string[] {
  const base = noun.toLowerCase();
  return [
    base,
    `${adjective.toLowerCase()} ${base}`,
    ...vocabulary.useCases.map((useCase) => `${base} for ${useCase}`),
    `best ${base}`,
    `${base} gift`,
  ];
}
