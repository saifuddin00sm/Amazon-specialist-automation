import { z } from "zod";
import { isSkippedPlanLine, parseCampaignPlanLine, type CampaignPlanLine } from "./campaign-plan";
import { LISTING_LIMITS, utf8ByteLength, type ListingVersion, type ProductFacts } from "./catalog";
import { parseNewCampaignPlan } from "./new-campaign";
import { DEFAULT_GUARDRAILS, type Guardrails } from "./workspace";
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

/**
 * Amazon's own limits, the same for every account. The caps an owner sets per account (max bid,
 * max daily budget, step sizes) are Guardrails in workspace.ts.
 */
export const AD_GUARDRAILS = {
  minBid: 0.02,
  minDailyBudget: 1,
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
  /** The account's caps; DEFAULT_GUARDRAILS when left out. */
  guardrails?: Guardrails;
};

/** Guardrail checks for any proposal type. An empty list means no checks apply. */
export function checkProposalCompliance({ type, diff, liveListing, facts, guardrails = DEFAULT_GUARDRAILS }: ComplianceInput): ComplianceCheck[] {
  const bidRange = (bid: number) => bidRangeCheck(bid, guardrails);
  switch (type) {
    case "listing_update":
      if (!liveListing) return [{ id: "live_listing", label: "Live listing", status: "fail", detail: "The live listing could not be loaded." }];
      return checkListingCompliance(proposedListingCopy(liveListing, diff), facts);
    case "bid_change":
      return numericChanges(diff).flatMap(({ before, after }) => [bidRange(after), stepCheck("bid_step", "Bid change size", before, after, guardrails.maxBidStep)]);
    case "budget_change":
      return numericChanges(diff).flatMap(({ before, after }) => [
        after < AD_GUARDRAILS.minDailyBudget
          ? { id: "budget_min", label: "Minimum daily budget", status: "fail" as const, detail: `Daily budget must be at least ${AD_GUARDRAILS.minDailyBudget}.` }
          : { id: "budget_min", label: "Minimum daily budget", status: "pass" as const },
        after > guardrails.maxDailyBudget
          ? { id: "budget_max", label: "Daily budget cap", status: "fail" as const, detail: `${after} is above the ${guardrails.maxDailyBudget} cap.` }
          : { id: "budget_max", label: "Daily budget cap", status: "pass" as const, detail: `Cap is ${guardrails.maxDailyBudget}.` },
        stepCheck("budget_step", "Budget change size", before, after, guardrails.maxBudgetStep),
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
    case "campaign_plan":
      return checkCampaignPlan(diff, guardrails);
    case "new_campaign":
      return checkNewCampaignPlan(diff, guardrails);
  }
}

/** Budgets, bids and keywords of campaigns a plan would create, one check per guardrail. */
function checkNewCampaignPlan(diff: DiffEntry[], guardrails: Guardrails): ComplianceCheck[] {
  const { brief, campaigns, unreadable } = parseNewCampaignPlan(diff);
  const checks: ComplianceCheck[] = [
    unreadable.length > 0 || !brief
      ? { id: "plan_lines", label: "Plan changes", status: "fail", detail: brief ? `${unreadable.length} ${unreadable.length === 1 ? "line isn't" : "lines aren't"} a campaign.` : "The plan has no brief." }
      : campaigns.length === 0
        ? { id: "plan_lines", label: "Plan changes", status: "fail", detail: "The plan creates no campaigns." }
        : { id: "plan_lines", label: "Plan changes", status: "pass", detail: `${campaigns.length} new ${campaigns.length === 1 ? "campaign" : "campaigns"}.` },
  ];
  if (campaigns.length === 0) return checks;

  const budgets = campaigns.map((campaign) => campaign.dailyBudget);
  const low = budgets.filter((budget) => budget < AD_GUARDRAILS.minDailyBudget).length;
  const high = budgets.filter((budget) => budget > guardrails.maxDailyBudget).length;
  checks.push(
    low > 0
      ? { id: "budget_min", label: "Minimum daily budget", status: "fail", detail: `${low} ${low === 1 ? "campaign is" : "campaigns are"} under ${AD_GUARDRAILS.minDailyBudget} a day.` }
      : { id: "budget_min", label: "Minimum daily budget", status: "pass" },
    high > 0
      ? { id: "budget_max", label: "Daily budget cap", status: "fail", detail: `${high} ${high === 1 ? "campaign is" : "campaigns are"} above the ${guardrails.maxDailyBudget} cap.` }
      : { id: "budget_max", label: "Daily budget cap", status: "pass", detail: `Cap is ${guardrails.maxDailyBudget} per campaign.` },
  );
  const total = Math.round(budgets.reduce((sum, budget) => sum + budget, 0) * 100) / 100;
  if (brief && total > brief.dailyBudget) {
    checks.push({ id: "budget_total", label: "Total daily budget", status: "fail", detail: `Campaigns add up to ${total}, above the ${brief.dailyBudget} in the brief.` });
  }

  const adGroups = campaigns.flatMap((campaign) => campaign.adGroups);
  const bids = adGroups.flatMap((adGroup) => [adGroup.defaultBid, ...adGroup.targets.map((target) => target.bid)]);
  const outside = bids.filter((bid) => bidRangeCheck(bid, guardrails).status === "fail").length;
  const range = `${AD_GUARDRAILS.minBid} and ${guardrails.maxBid}`;
  checks.push(
    outside > 0
      ? { id: "bid_range", label: "Bids within guardrails", status: "fail", detail: `${outside} of ${bids.length} bids aren't between ${range}.` }
      : { id: "bid_range", label: "Bids within guardrails", status: "pass", detail: `${bids.length} bids between ${range}.` },
  );

  const keywords = adGroups.flatMap((adGroup) => [
    ...adGroup.targets.flatMap((target) => (target.kind === "keyword" ? [target.keyword] : [])),
    ...adGroup.negativeKeywords.map((negative) => negative.keyword),
  ]);
  if (keywords.length > 0) checks.push(keywordCheck(keywords));

  // Funneling negates a keyword exact where it is bought broad or phrase; the same match both ways is a conflict.
  const conflicts = new Set<string>();
  for (const adGroup of adGroups) {
    const seen = new Set<string>();
    for (const target of adGroup.targets) {
      const key = target.kind === "keyword" ? `${target.keyword.trim().toLowerCase()}|${target.matchType}` : target.kind === "product" ? target.asin : target.autoType;
      if (seen.has(key)) conflicts.add(`${adGroup.name} targets ${key.split("|")[0]} twice`);
      seen.add(key);
    }
    for (const negative of adGroup.negativeKeywords) {
      if (seen.has(`${negative.keyword.trim().toLowerCase()}|${negative.matchType}`)) conflicts.add(`${adGroup.name} both targets and negates "${negative.keyword}"`);
    }
  }
  checks.push(
    conflicts.size > 0
      ? { id: "plan_conflicts", label: "Conflicting targets", status: "fail", detail: `${[...conflicts].join("; ")}.` }
      : { id: "plan_conflicts", label: "Conflicting targets", status: "pass" },
  );

  if (brief?.breakEvenAcos !== undefined) {
    checks.push(
      brief.targetAcos > brief.breakEvenAcos
        ? {
            id: "acos_breakeven",
            label: "Target ACoS against breakeven",
            status: "warn",
            detail: `Targets ${Math.round(brief.targetAcos * 100)}% ACoS, above the ${Math.round(brief.breakEvenAcos * 100)}% breakeven: ad orders lose money.`,
          }
        : { id: "acos_breakeven", label: "Target ACoS against breakeven", status: "pass", detail: `Breakeven is ${Math.round(brief.breakEvenAcos * 100)}%.` },
    );
  }
  return checks;
}

/** One check per guardrail over every line of the plan, so a long plan still reads as a short list. */
function checkCampaignPlan(diff: DiffEntry[], guardrails: Guardrails): ComplianceCheck[] {
  const parsed = diff.map(parseCampaignPlanLine);
  const lines = parsed.filter((line): line is CampaignPlanLine => line !== undefined && !isSkippedPlanLine(line));
  const unreadable = parsed.filter((line) => line === undefined).length;
  const checks: ComplianceCheck[] = [
    unreadable > 0
      ? { id: "plan_lines", label: "Plan changes", status: "fail", detail: `${unreadable} ${unreadable === 1 ? "change isn't" : "changes aren't"} a bid, keyword or negative keyword.` }
      : lines.length === 0
        ? { id: "plan_lines", label: "Plan changes", status: "fail", detail: "Every change is skipped. Reject the plan instead." }
        : { id: "plan_lines", label: "Plan changes", status: "pass", detail: `${lines.length} ${lines.length === 1 ? "change" : "changes"}.` },
  ];

  const bids = lines.flatMap((line) => (line.kind === "bid" ? [line.after] : line.kind === "keyword" && line.after ? [line.after.bid] : []));
  if (bids.length > 0) {
    const outside = bids.filter((bid) => bidRangeCheck(bid, guardrails).status === "fail").length;
    const range = `${AD_GUARDRAILS.minBid} and ${guardrails.maxBid}`;
    checks.push(
      outside > 0
        ? { id: "bid_range", label: "Bids within guardrails", status: "fail", detail: `${outside} of ${bids.length} bids aren't between ${range}.` }
        : { id: "bid_range", label: "Bids within guardrails", status: "pass", detail: `${bids.length} ${bids.length === 1 ? "bid" : "bids"} between ${range}.` },
    );
  }

  const steps = lines.flatMap((line) =>
    line.kind === "bid" && line.before > 0 && Math.abs(line.after - line.before) / line.before > guardrails.maxBidStep ? [line] : [],
  );
  if (lines.some((line) => line.kind === "bid")) {
    checks.push(
      steps.length > 0
        ? { id: "bid_step", label: "Bid change size", status: "warn", detail: `${steps.length} ${steps.length === 1 ? "bid moves" : "bids move"} more than ±${Math.round(guardrails.maxBidStep * 100)}% in one step.` }
        : { id: "bid_step", label: "Bid change size", status: "pass", detail: `Every bid stays within ±${Math.round(guardrails.maxBidStep * 100)}%.` },
    );
  }

  const keywords = lines.flatMap((line) => (line.kind !== "bid" && line.after ? [{ ...line.after, kind: line.kind, adGroupId: line.adGroupId }] : []));
  if (keywords.length > 0) {
    checks.push(keywordCheck(keywords.map((keyword) => keyword.keyword)));
    const seen = new Map<string, string>();
    const conflicts = new Set<string>();
    for (const keyword of keywords) {
      const key = `${keyword.adGroupId}|${keyword.keyword.trim().toLowerCase()}`;
      const previous = seen.get(key);
      if (previous !== undefined) conflicts.add(previous === keyword.kind ? `"${keyword.keyword.trim()}" is added twice` : `"${keyword.keyword.trim()}" is both added and negated`);
      seen.set(key, keyword.kind);
    }
    checks.push(
      conflicts.size > 0
        ? { id: "plan_conflicts", label: "Conflicting keywords", status: "fail", detail: `${[...conflicts].join("; ")} in one ad group.` }
        : { id: "plan_conflicts", label: "Conflicting keywords", status: "pass" },
    );
  }
  return checks;
}

export function hasBlockingFailure(checks: ComplianceCheck[]): boolean {
  return checks.some((check) => check.status === "fail");
}

function bidRangeCheck(bid: number, guardrails: Guardrails): ComplianceCheck {
  return bid < AD_GUARDRAILS.minBid || bid > guardrails.maxBid
    ? { id: "bid_range", label: "Bid within guardrails", status: "fail", detail: `Bids must be between ${AD_GUARDRAILS.minBid} and ${guardrails.maxBid}.` }
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
