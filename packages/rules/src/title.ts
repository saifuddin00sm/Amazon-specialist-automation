import { LISTING_LIMITS, type Violation } from "@app/core";
import { escapeRegExp, wordEdge } from "./text";

/** Characters Amazon does not allow in titles, unless they are part of the brand name. */
export const TITLE_BANNED_CHARACTERS = ["!", "$", "?", "_", "{", "}", "^", "¬", "¦"] as const;

/** A word may appear at most this many times in a title. */
export const TITLE_MAX_WORD_REPEATS = 2;

/**
 * Title length limits for categories that differ from Amazon's 200 characters, keyed by product
 * type (case does not matter). Empty until the per-marketplace numbers are confirmed in Seller
 * Central; callers pass their own through `lengthOverrides` meanwhile.
 */
export const TITLE_LENGTH_OVERRIDES: Readonly<Record<string, number>> = {};

/** Articles, prepositions and conjunctions: Amazon lets these repeat. */
const REPEATABLE_WORDS = new Set([
  // Articles
  "a", "an", "the",
  // Prepositions
  "about", "above", "across", "after", "against", "along", "among", "around", "as", "at", "before", "behind", "below",
  "beneath", "beside", "between", "beyond", "by", "down", "during", "except", "for", "from", "in", "inside", "into",
  "like", "near", "of", "off", "on", "onto", "out", "outside", "over", "per", "since", "through", "to", "toward",
  "towards", "under", "until", "up", "upon", "via", "with", "within", "without",
  // Conjunctions
  "and", "but", "either", "if", "neither", "nor", "or", "plus", "so", "than", "though", "whether", "while", "yet",
]);

/** Plurals that don't end in a plain -s or -es. */
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  children: "child",
  feet: "foot",
  geese: "goose",
  knives: "knife",
  leaves: "leaf",
  men: "man",
  mice: "mouse",
  people: "person",
  shelves: "shelf",
  teeth: "tooth",
  wives: "wife",
  women: "woman",
};

const BANNED = new Set<string>(TITLE_BANNED_CHARACTERS);

export type TitleOptions = {
  /** The brand name; banned characters inside it are allowed. */
  brand?: string;
  /** Per-category length limits, on top of TITLE_LENGTH_OVERRIDES. */
  lengthOverrides?: Readonly<Record<string, number>>;
};

/** The longest title a category allows: its override, or Amazon's 200 characters. */
export function titleMaxLength(category: string | undefined, overrides: Readonly<Record<string, number>> = {}): number {
  if (!category) return LISTING_LIMITS.titleMaxLength;
  const key = category.trim().toUpperCase();
  const limits = new Map(Object.entries({ ...TITLE_LENGTH_OVERRIDES, ...overrides }).map(([name, limit]) => [name.trim().toUpperCase(), limit]));
  return limits.get(key) ?? LISTING_LIMITS.titleMaxLength;
}

/** Amazon's title policy: length for the category, banned characters, and words repeated more than twice. */
export function checkTitle(title: string, category?: string, options: TitleOptions = {}): Violation[] {
  const trimmed = title.normalize("NFC").trim();
  if (trimmed.length === 0) return [{ rule: "title_empty", severity: "error", message: "Title is empty.", path: "title" }];

  const violations: Violation[] = [];
  // Code points, so an emoji or an accented letter counts as one character.
  const length = Array.from(trimmed).length;
  const limit = titleMaxLength(category, options.lengthOverrides);
  if (length > limit) {
    violations.push({
      rule: "title_length",
      severity: "error",
      message: `Title is ${length} characters; ${category ? `${category} allows` : "the limit is"} ${limit}.`,
      path: "title",
      count: length,
      limit,
    });
  }
  violations.push(...bannedCharacters(title, options.brand), ...repeatedWords(title));
  return violations;
}

function bannedCharacters(title: string, brand: string | undefined): Violation[] {
  const allowed = brandRanges(title, brand);
  const violations: Violation[] = [];
  for (let index = 0; index < title.length; index++) {
    const character = title[index]!;
    if (!BANNED.has(character) || allowed.some(([start, end]) => index >= start && index < end)) continue;
    violations.push({
      rule: "title_banned_character",
      severity: "error",
      message: `"${character}" is not allowed in titles${brand ? " outside the brand name" : ""}.`,
      path: "title",
      match: character,
      index,
    });
  }
  return violations;
}

/** Where the brand name appears in the title, case-insensitively, as [start, end) offsets. */
function brandRanges(title: string, brand: string | undefined): [number, number][] {
  const name = brand?.trim();
  if (!name) return [];
  const pattern = new RegExp(`${wordEdge(name[0]!, "before")}${escapeRegExp(name)}${wordEdge(name.at(-1)!, "after")}`, "giu");
  return [...title.matchAll(pattern)].map((found) => [found.index, found.index + found[0].length]);
}

function repeatedWords(title: string): Violation[] {
  const found: { word: string; lower: string; index: number }[] = [];
  for (const { 0: word, index } of title.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}\p{N}]+)*/gu)) {
    // Combining accents belong to the word, and "café" is one word however it's encoded.
    const lower = word.normalize("NFC").toLowerCase();
    // Numbers and sizes aren't words; "2 Pack, 2 Lids, 2 Straws" is fine.
    if (/\p{L}/u.test(lower) && !REPEATABLE_WORDS.has(lower)) found.push({ word, lower, index });
  }

  // Shortest first, so each plural joins the singular (or shorter plural) already seen in this title.
  const keys = new Map<string, string>();
  for (const lower of [...new Set(found.map((use) => use.lower))].sort((a, b) => a.length - b.length)) {
    const base = singularCandidates(lower).find((candidate) => keys.has(candidate));
    keys.set(lower, base === undefined ? lower : keys.get(base)!);
  }

  const uses = new Map<string, typeof found>();
  for (const use of found) {
    const key = keys.get(use.lower)!;
    uses.set(key, [...(uses.get(key) ?? []), use]);
  }
  return [...uses].flatMap(([key, all]) =>
    all.length > TITLE_MAX_WORD_REPEATS
      ? [
          {
            rule: "title_word_repetition" as const,
            severity: "error" as const,
            message: `"${key}" appears ${all.length} times (${all.map(({ word }) => word).join(", ")}); at most ${TITLE_MAX_WORD_REPEATS}.`,
            path: "title",
            match: key,
            // The first use over the limit.
            index: all[TITLE_MAX_WORD_REPEATS]!.index,
            count: all.length,
            limit: TITLE_MAX_WORD_REPEATS,
          },
        ]
      : [],
  );
}

/**
 * The forms a lowercase word could be the plural of. Guessing all of them, and matching against the
 * other words in the title, gets "cases" → "case" and "glasses" → "glass" right without a dictionary.
 */
function singularCandidates(word: string): string[] {
  // A possessive is the word itself: "men's" is "men".
  const possessive = word.match(/^(.+)['’]s$/)?.[1];
  if (possessive) return [possessive, ...singularCandidates(possessive)];
  const candidates: string[] = [];
  const irregular = IRREGULAR_PLURALS[word];
  if (irregular) candidates.push(irregular);
  if (word.endsWith("ies") && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 3) candidates.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 2) candidates.push(word.slice(0, -1));
  return candidates;
}
