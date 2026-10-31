import { z } from "zod";
import { LISTING_LIMITS, utf8ByteLength, type ListingVersion, type ProductFacts } from "./catalog";
import type { DiffEntry, ProposalType } from "./proposal";

export const ComplianceStatusSchema = z.enum(["pass", "warn", "fail"]);
export type ComplianceStatus = z.infer<typeof ComplianceStatusSchema>;

/** One Guardrail evaluated against a proposed change. A `fail` blocks approval. */
export const ComplianceCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: ComplianceStatusSchema,
  detail: z.string().optional(),
});
export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>;

export type ListingCopy = Pick<ListingVersion, "title" | "bullets" | "description" | "backendKeywords">;

export const LISTING_COPY_FIELDS = ["title", "bullets", "description", "backendKeywords"] as const;

/** Phrases Amazon restricts in listing copy for every product. */
export const RESTRICTED_TERMS = [
  "best seller",
  "best-selling",
  "#1",
  "number one",
  "guaranteed",
  "free shipping",
  "on sale",
  "discount",
  "money back",
  "limited time",
] as const;

/** Characters Amazon does not allow in titles. */
const TITLE_BANNED_CHARACTERS = /[!$?_{}^¬¦]/;

/** Guardrails for bids and budgets, in the account's currency. */
export const AD_GUARDRAILS = {
  minBid: 0.02,
  maxBid: 50,
  /** A bid moving more than this share in one step gets a warning. */
  maxBidStep: 0.5,
  minDailyBudget: 1,
  /** A budget increase above this share in one step gets a warning. */
  maxBudgetStep: 1,
  /** A price move above this share in one step gets a warning. */
  maxPriceStep: 0.2,
  keywordMaxLength: 80,
  keywordMaxWords: 10,
} as const;

/** The full listing a proposal would publish: the live copy with the diff's `after` values on top. */
export function proposedListingCopy(live: ListingCopy, diff: DiffEntry[]): ListingCopy {
  const copy: ListingCopy = { ...live, bullets: [...live.bullets] };
  for (const entry of diff) {
    if (entry.path === "title" && typeof entry.after === "string") copy.title = entry.after;
    if (entry.path === "description" && typeof entry.after === "string") copy.description = entry.after;
    if (entry.path === "backendKeywords" && typeof entry.after === "string") copy.backendKeywords = entry.after;
    if (entry.path === "bullets" && Array.isArray(entry.after)) {
      copy.bullets = entry.after.map((bullet) => (typeof bullet === "string" ? bullet : String(bullet)));
    }
  }
  return copy;
}

export function checkListingCompliance(copy: ListingCopy, facts: ProductFacts | undefined): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const title = copy.title.trim();

  checks.push(
    title.length === 0
      ? { id: "title_length", label: "Title length", status: "fail", detail: "Title is empty." }
      : title.length > LISTING_LIMITS.titleMaxLength
        ? { id: "title_length", label: "Title length", status: "fail", detail: `${title.length} of ${LISTING_LIMITS.titleMaxLength} characters.` }
        : { id: "title_length", label: "Title length", status: "pass", detail: `${title.length} of ${LISTING_LIMITS.titleMaxLength} characters.` },
  );

  const banned = title.match(TITLE_BANNED_CHARACTERS);
  checks.push(
    banned
      ? { id: "title_characters", label: "Title characters", status: "fail", detail: `"${banned[0]}" is not allowed in titles.` }
      : { id: "title_characters", label: "Title characters", status: "pass" },
  );

  const repeated = repeatedWords(title);
  checks.push(
    repeated.length > 0
      ? { id: "title_repetition", label: "Title word repetition", status: "warn", detail: `Repeated more than twice: ${repeated.join(", ")}.` }
      : { id: "title_repetition", label: "Title word repetition", status: "pass" },
  );

  const bulletProblems = copy.bullets.flatMap((bullet, i) =>
    bullet.trim().length === 0
      ? [`Bullet ${i + 1} is empty.`]
      : bullet.length > LISTING_LIMITS.bulletMaxLength
        ? [`Bullet ${i + 1} is ${bullet.length} characters.`]
        : [],
  );
  if (copy.bullets.length === 0 || copy.bullets.length > LISTING_LIMITS.bulletMaxCount) {
    bulletProblems.unshift(`${copy.bullets.length} bullets; use 1 to ${LISTING_LIMITS.bulletMaxCount}.`);
  }
  checks.push(
    bulletProblems.length > 0
      ? { id: "bullets", label: "Bullet points", status: "fail", detail: bulletProblems.join(" ") }
      : copy.bullets.length < LISTING_LIMITS.bulletMaxCount
        ? { id: "bullets", label: "Bullet points", status: "warn", detail: `${copy.bullets.length} of ${LISTING_LIMITS.bulletMaxCount} bullets used.` }
        : { id: "bullets", label: "Bullet points", status: "pass" },
  );

  checks.push(
    copy.description.length > LISTING_LIMITS.descriptionMaxLength
      ? { id: "description_length", label: "Description length", status: "fail", detail: `${copy.description.length} of ${LISTING_LIMITS.descriptionMaxLength} characters.` }
      : { id: "description_length", label: "Description length", status: "pass", detail: `${copy.description.length} of ${LISTING_LIMITS.descriptionMaxLength} characters.` },
  );

  const bytes = utf8ByteLength(copy.backendKeywords);
  checks.push(
    bytes > LISTING_LIMITS.backendKeywordsMaxBytes
      ? { id: "backend_keywords", label: "Backend search terms", status: "fail", detail: `${bytes} of ${LISTING_LIMITS.backendKeywordsMaxBytes} bytes.` }
      : { id: "backend_keywords", label: "Backend search terms", status: "pass", detail: `${bytes} of ${LISTING_LIMITS.backendKeywordsMaxBytes} bytes.` },
  );

  const fields = listingText(copy);
  const prohibited = (facts?.prohibitedClaims ?? []).flatMap((claim) => {
    const found = fields.filter(([, text]) => includesPhrase(text, claim)).map(([field]) => field);
    return found.length > 0 ? [`"${claim}" in ${found.join(", ")}`] : [];
  });
  checks.push(
    !facts
      ? { id: "prohibited_claims", label: "Prohibited claims", status: "warn", detail: "No ProductFacts to check against." }
      : prohibited.length > 0
        ? { id: "prohibited_claims", label: "Prohibited claims", status: "fail", detail: `${prohibited.join("; ")}.` }
        : { id: "prohibited_claims", label: "Prohibited claims", status: "pass" },
  );

  const restricted = RESTRICTED_TERMS.filter((term) => fields.some(([, text]) => includesPhrase(text, term)));
  checks.push(
    restricted.length > 0
      ? { id: "restricted_terms", label: "Restricted terms", status: "fail", detail: `Uses ${restricted.map((term) => `"${term}"`).join(", ")}.` }
      : { id: "restricted_terms", label: "Restricted terms", status: "pass" },
  );

  return checks;
}

export type ComplianceInput = {
  type: ProposalType;
  diff: DiffEntry[];
  /** Live listing copy, for listing_update proposals. */
  liveListing?: ListingCopy;
  facts?: ProductFacts;
};

/** Guardrail checks for any proposal type. An empty list means no checks apply. */
export function checkProposalCompliance({ type, diff, liveListing, facts }: ComplianceInput): ComplianceCheck[] {
  switch (type) {
    case "listing_update":
      if (!liveListing) return [{ id: "live_listing", label: "Live listing", status: "fail", detail: "The live listing could not be loaded." }];
      return checkListingCompliance(proposedListingCopy(liveListing, diff), facts);
    case "bid_change":
      return numericChanges(diff).flatMap(({ before, after }) => [bidRange(after), stepCheck("bid_step", "Bid change size", before, after, AD_GUARDRAILS.maxBidStep)]);
    case "budget_change":
      return numericChanges(diff).flatMap(({ before, after }) => [
        after < AD_GUARDRAILS.minDailyBudget
          ? { id: "budget_min", label: "Minimum daily budget", status: "fail" as const, detail: `Daily budget must be at least ${AD_GUARDRAILS.minDailyBudget}.` }
          : { id: "budget_min", label: "Minimum daily budget", status: "pass" as const },
        stepCheck("budget_step", "Budget change size", before, after, AD_GUARDRAILS.maxBudgetStep),
      ]);
    case "price_change":
      return numericChanges(diff).flatMap(({ before, after }) => [
        after > 0
          ? { id: "price_positive", label: "Price", status: "pass" as const }
          : { id: "price_positive", label: "Price", status: "fail" as const, detail: "Price must be above zero." },
        stepCheck("price_step", "Price change size", before, after, AD_GUARDRAILS.maxPriceStep),
      ]);
    case "keyword_add":
      return diff.flatMap((entry) => {
        const value = entry.after;
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const keyword = typeof value.keyword === "string" ? value.keyword : "";
        return [keywordCheck([keyword]), ...(typeof value.bid === "number" ? [bidRange(value.bid)] : [])];
      });
    case "keyword_negate":
      return diff.flatMap((entry) => {
        const before = new Set(Array.isArray(entry.before) ? entry.before : []);
        const added = Array.isArray(entry.after) ? entry.after.filter((term) => !before.has(term)) : [];
        return [keywordCheck(added.map(String))];
      });
    case "target_pause":
      return [];
  }
}

export function hasBlockingFailure(checks: ComplianceCheck[]): boolean {
  return checks.some((check) => check.status === "fail");
}

function bidRange(bid: number): ComplianceCheck {
  return bid < AD_GUARDRAILS.minBid || bid > AD_GUARDRAILS.maxBid
    ? { id: "bid_range", label: "Bid within guardrails", status: "fail", detail: `Bids must be between ${AD_GUARDRAILS.minBid} and ${AD_GUARDRAILS.maxBid}.` }
    : { id: "bid_range", label: "Bid within guardrails", status: "pass" };
}

function stepCheck(id: string, label: string, before: number, after: number, maxStep: number): ComplianceCheck {
  const change = before > 0 ? (after - before) / before : 0;
  const detail = `${change >= 0 ? "+" : ""}${Math.round(change * 100)}% in one step.`;
  return Math.abs(change) > maxStep
    ? { id, label, status: "warn", detail: `${detail} Guardrail is ±${Math.round(maxStep * 100)}%.` }
    : { id, label, status: "pass", detail };
}

function keywordCheck(keywords: string[]): ComplianceCheck {
  const problems = keywords.flatMap((keyword) => {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) return ["Keyword is empty."];
    if (trimmed.length > AD_GUARDRAILS.keywordMaxLength) return [`"${trimmed.slice(0, 20)}…" is over ${AD_GUARDRAILS.keywordMaxLength} characters.`];
    if (trimmed.split(/\s+/).length > AD_GUARDRAILS.keywordMaxWords) return [`"${trimmed}" is over ${AD_GUARDRAILS.keywordMaxWords} words.`];
    return [];
  });
  if (keywords.length === 0) problems.push("No keyword to add.");
  return problems.length > 0
    ? { id: "keyword_format", label: "Keyword format", status: "fail", detail: problems.join(" ") }
    : { id: "keyword_format", label: "Keyword format", status: "pass" };
}

function numericChanges(diff: DiffEntry[]): { before: number; after: number }[] {
  return diff.flatMap((entry) =>
    typeof entry.before === "number" && typeof entry.after === "number" ? [{ before: entry.before, after: entry.after }] : [],
  );
}

function listingText(copy: ListingCopy): [string, string][] {
  return [
    ["title", copy.title],
    ["bullets", copy.bullets.join("\n")],
    ["description", copy.description],
    ["backend terms", copy.backendKeywords],
  ];
}

function includesPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word boundaries only where the phrase starts or ends with a word character ("#1" has none on the left).
  const left = /^\w/.test(phrase) ? "\\b" : "";
  const right = /\w$/.test(phrase) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`).test(text.toLowerCase());
}

const STOP_WORDS = new Set(["and", "for", "the", "with", "of", "to", "in", "a", "an", "or", "&", "–", "-"]);

function repeatedWords(title: string): string[] {
  const counts = new Map<string, number>();
  for (const word of title.toLowerCase().split(/[\s,]+/)) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 2).map(([word]) => word);
}
