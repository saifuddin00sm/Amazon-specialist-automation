import { ViolationSchema } from "@app/core";
import { describe, expect, it } from "vitest";
import { checkTitle, titleMaxLength, type TitleOptions } from "./title";

const CLEAN = "Northlane Insulated Water Bottle for Gym, Stainless Steel, Sage Green, 32 oz";

const rules = (title: string, category?: string, options?: TitleOptions) => checkTitle(title, category, options).map((violation) => violation.rule);
const ofRule = (title: string, rule: string, options?: TitleOptions) => checkTitle(title, undefined, options).filter((violation) => violation.rule === rule);

describe("checkTitle", () => {
  it("passes a clean title", () => {
    expect(checkTitle(CLEAN, "BOTTLE")).toEqual([]);
  });

  it("returns violations that match the core Violation schema", () => {
    const violations = checkTitle(`${"Bottle ".repeat(3)}! ${"x".repeat(200)}`);
    expect(violations.map((violation) => violation.rule).sort()).toEqual(["title_banned_character", "title_length", "title_word_repetition"]);
    for (const violation of violations) expect(ViolationSchema.parse(violation)).toEqual(violation);
  });

  it("fails an empty or whitespace-only title, and nothing else", () => {
    expect(rules("")).toEqual(["title_empty"]);
    expect(rules("   \n\t")).toEqual(["title_empty"]);
  });
});

describe("title length", () => {
  it("allows exactly 200 characters and fails 201", () => {
    expect(rules("x".repeat(200))).toEqual([]);
    expect(checkTitle("x".repeat(201))).toEqual([
      { rule: "title_length", severity: "error", message: "Title is 201 characters; the limit is 200.", path: "title", count: 201, limit: 200 },
    ]);
  });

  it("doesn't count leading and trailing whitespace", () => {
    expect(rules(`  ${"x".repeat(200)}  `)).toEqual([]);
  });

  it("counts an emoji or an accented letter as one character, composed or not", () => {
    expect(rules("😀".repeat(200))).toEqual([]);
    expect(rules("é".repeat(200))).toEqual([]);
    expect(rules("é".repeat(201))).toEqual(["title_length"]);
  });

  it("applies a category override, lower or higher", () => {
    const lengthOverrides = { SHIRT: 80, BOOK: 250 };
    expect(rules("x".repeat(81), "SHIRT", { lengthOverrides })).toEqual(["title_length"]);
    expect(rules("x".repeat(80), "SHIRT", { lengthOverrides })).toEqual([]);
    expect(rules("x".repeat(250), "BOOK", { lengthOverrides })).toEqual([]);
    expect(checkTitle("x".repeat(81), "SHIRT", { lengthOverrides })[0]).toMatchObject({ message: "Title is 81 characters; SHIRT allows 80.", limit: 80 });
  });

  it("matches the category case-insensitively and ignores surrounding spaces", () => {
    expect(titleMaxLength(" shirt ", { SHIRT: 80 })).toBe(80);
    expect(titleMaxLength("SHIRT", { " Shirt": 80 })).toBe(80);
  });

  it("falls back to 200 for a category without an override, or no category", () => {
    expect(titleMaxLength("LUGGAGE", { SHIRT: 80 })).toBe(200);
    expect(titleMaxLength(undefined, { SHIRT: 80 })).toBe(200);
    expect(titleMaxLength("")).toBe(200);
  });
});

describe("title banned characters", () => {
  it.each(["!", "$", "?", "_", "{", "}", "^", "¬", "¦"])("fails %s", (character) => {
    expect(ofRule(`Water Bottle ${character} Gym`, "title_banned_character")).toEqual([
      { rule: "title_banned_character", severity: "error", message: `"${character}" is not allowed in titles.`, path: "title", match: character, index: 13 },
    ]);
  });

  it("allows characters Amazon permits, like & - , . / ( ) % + and quotes", () => {
    expect(rules("Bottle & Lid - 32 oz, 1.5 L / 50% Off (Pack of 2) + Straw \"Pro\" 'Max' #4 @Home")).toEqual([]);
  });

  it("reports each banned character with its offset", () => {
    expect(ofRule("Wow! Big $ale?", "title_banned_character").map(({ match, index }) => [match, index])).toEqual([
      ["!", 3],
      ["$", 9],
      ["?", 13],
    ]);
  });

  it("allows banned characters inside the brand name, case-insensitively", () => {
    expect(rules("Yahoo! Water Bottle", undefined, { brand: "Yahoo!" })).toEqual([]);
    expect(rules("YAHOO! Water Bottle", undefined, { brand: "Yahoo!" })).toEqual([]);
    expect(rules("Water Bottle by e_Shop", undefined, { brand: "e_Shop" })).toEqual([]);
  });

  it("still fails banned characters outside the brand name", () => {
    const violations = ofRule("Yahoo! Water Bottle!", "title_banned_character", { brand: "Yahoo!" });
    expect(violations.map(({ index }) => index)).toEqual([19]);
    expect(violations[0]?.message).toBe('"!" is not allowed in titles outside the brand name.');
  });

  it("only treats the brand as whole words, so a longer word containing it isn't excused", () => {
    expect(rules("Pay$ Bottle", undefined, { brand: "Pay$" })).toEqual([]);
    expect(rules("RePay$ Bottle", undefined, { brand: "Pay$" })).toEqual(["title_banned_character"]);
  });

  it("fails a banned character when the brand isn't in the title, or is blank", () => {
    expect(rules("Water Bottle!", undefined, { brand: "Yahoo!" })).toEqual(["title_banned_character"]);
    expect(rules("Water Bottle!", undefined, { brand: "  " })).toEqual(["title_banned_character"]);
  });
});

describe("title word repetition", () => {
  it("allows a word twice and fails it three times, case-insensitively", () => {
    expect(rules("Bottle Lid for Water Bottle")).toEqual([]);
    expect(checkTitle("Bottle Lid for Water bottle, BOTTLE Brush")).toEqual([
      {
        rule: "title_word_repetition",
        severity: "error",
        message: '"bottle" appears 3 times (Bottle, bottle, BOTTLE); at most 2.',
        path: "title",
        match: "bottle",
        index: 29,
        count: 3,
        limit: 2,
      },
    ]);
  });

  it("counts plurals as the same word", () => {
    expect(ofRule("Bottle with 2 Bottles and Spare Bottle Lids", "title_word_repetition")[0]).toMatchObject({ match: "bottle", count: 3 });
    expect(rules("Battery Charger for Batteries, Battery Case")).toEqual(["title_word_repetition"]);
    expect(rules("Box Organizer with Boxes and Box Lids")).toEqual(["title_word_repetition"]);
    expect(rules("Brush Set, Brushes and Brush Holder")).toEqual(["title_word_repetition"]);
  });

  it("gets -es plurals right whether the singular ends in -s or -e", () => {
    expect(rules("Glass Cup, Glasses, Glass Lid")).toEqual(["title_word_repetition"]);
    expect(ofRule("Phone Case, Cases and Case Strap", "title_word_repetition")[0]).toMatchObject({ match: "case", count: 3 });
    expect(rules("Lens Cap, Lenses, Lens Cloth")).toEqual(["title_word_repetition"]);
  });

  it("counts irregular plurals as the same word", () => {
    expect(rules("Knife Block with Knives and Knife Sharpener")).toEqual(["title_word_repetition"]);
    expect(rules("Men's Shirt, Man Cave, Men Gift")).toEqual(["title_word_repetition"]);
  });

  it("counts only plurals, not every word sharing a prefix", () => {
    expect(rules("Bottle Bottles Bottled Bottler")).toEqual([]);
  });

  it("lets articles, prepositions and conjunctions repeat", () => {
    expect(rules("The Bottle for the Gym, for the Office and for the Car, with a Lid and a Straw or a Cap")).toEqual([]);
    expect(rules("Bag in a Box, in a Car, in a Van, on a Bike, on a Bus, on a Boat, by a Lake, by a Sea, by a Bay")).toEqual([]);
  });

  it("doesn't count numbers as words", () => {
    expect(rules("2 Pack Bottles, 2 Lids, 2 Straws, 2 Brushes")).toEqual([]);
  });

  it("counts words with digits in them, and hyphenated parts as separate words", () => {
    expect(rules("500ml Bottle, 500ml Flask, 500ml Cup")).toEqual(["title_word_repetition"]);
    expect(rules("Steel-Lid Steel Bottle, Steel Straw")).toEqual(["title_word_repetition"]);
  });

  it("reports each repeated word once", () => {
    const violations = ofRule("Red Cup Red Lid Red Cup Cup Lid", "title_word_repetition");
    expect(violations.map(({ match, count }) => [match, count])).toEqual([
      ["red", 3],
      ["cup", 3],
    ]);
  });

  it("matches non-English letters, and the same word with a composed or decomposed accent", () => {
    expect(rules("Café Mug, Café Cup, Café Lid")).toEqual(["title_word_repetition"]);
    expect(ofRule("Café Mug, Café Cup, Cafés", "title_word_repetition")[0]).toMatchObject({ match: "café", count: 3 });
  });
});
