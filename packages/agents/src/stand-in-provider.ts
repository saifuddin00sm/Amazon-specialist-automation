import {
  LISTING_LIMITS,
  changedListingPaths,
  listingText,
  utf8ByteLength,
  type FactSheetEntry,
  type ListingCopy,
  type ListingCopyPath,
  type ListingDraft,
  type ListingRubricScores,
} from "@app/core";
import { LlmProviderError, PROMPTS, estimateTokens, type Completion, type CompletionRequest, type LlmProvider, type PromptInput, type PromptOutput } from "@app/llm";

type RewriteInput = PromptInput<typeof PROMPTS.listingRewrite>;
type ReviewInput = PromptInput<typeof PROMPTS.listingReview>;
type ReviewOutput = PromptOutput<typeof PROMPTS.listingReview>;

/**
 * A provider with no model behind it, for running the listing optimizer's workflow end to end where
 * no model may be called (the e2e, local development without a key). It answers the writer and the
 * reviewer in code from the prompt's input: a first draft with deliberate gaps (the product's first
 * prohibited claim in a bullet, no keyword in the title, three bullets), a revision that fixes what
 * it was told, and scores derived from the draft. Its calls are logged as `scripted`, so the run
 * viewer marks them simulated. Nothing leaves the process.
 */
export function createStandInProvider({ latencyMs = 0 }: { latencyMs?: number } = {}): LlmProvider {
  return {
    name: "scripted",
    dataPolicy: { trainsOnInputs: false, basis: "No model is called: answers are written in code and nothing leaves the process." },
    async complete(request: CompletionRequest): Promise<Completion> {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const answer = standInAnswer(request);
      const text = JSON.stringify(answer);
      return {
        model: request.model,
        text,
        stopReason: "end",
        usage: { inputTokens: estimateTokens(request.system) + estimateTokens(request.user), outputTokens: estimateTokens(text), cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

function standInAnswer({ prompt }: CompletionRequest): unknown {
  if (prompt.id === PROMPTS.listingRewrite.id && prompt.version === PROMPTS.listingRewrite.version) return standInRewrite(prompt.input as RewriteInput);
  if (prompt.id === PROMPTS.listingReview.id && prompt.version === PROMPTS.listingReview.version) return standInReview(prompt.input as ReviewInput);
  throw new LlmProviderError(`The stand-in provider has no answer for ${prompt.id} v${prompt.version}.`, false);
}

/** The writer: a weak first draft, then a revision once there are findings to fix. */
export function standInRewrite(input: RewriteInput): ListingDraft {
  const fact = (ref: string) => input.facts.find((entry) => entry.ref === ref)?.fact ?? "";
  const facts = (prefix: string) => input.facts.filter((entry) => entry.ref.startsWith(`${prefix}.`));
  const brand = fact("brand");
  const material = fact("material");
  const color = fact("color");
  const features = facts("features");
  const components = facts("includedComponents");
  // The bare product name, without the color, material or "for …" tail an earlier rewrite added.
  const name = input.live.title.split(/,| – | for /)[0]?.trim() || brand;
  const primary = input.keywords.find((keyword) => !name.toLowerCase().includes(keyword.toLowerCase())) ?? input.keywords[0];
  const bullet = (entry: FactSheetEntry) => `${headline(entry.fact)} – ${entry.fact}`;
  const revising = input.findings.length > 0;
  const limits = input.limits;

  const listing: ListingCopy = revising
    ? {
        title: limit(`${[name, primary ? titleCase(missingWords(primary, name)) : ""].filter(Boolean).join(" ")} – ${material}, ${color}`, limits.titleMaxLength),
        bullets: [
          ...features.slice(0, limits.bulletMaxCount - 1).map(bullet),
          ...(components.length > 0 ? [`WHAT'S INCLUDED – ${components.map((entry) => entry.fact).join(", ")}.`] : []),
        ].map((text) => limit(text, limits.bulletMaxLength)),
        description: limit(
          [`Meet the ${name}, made from ${material.toLowerCase()} in ${color.toLowerCase()}.`, ...features.map((entry) => entry.fact), ...(components.length > 0 ? [`In the box: ${components.map((entry) => entry.fact).join(", ")}.`] : [])].join(" "),
          limits.descriptionMaxLength,
        ),
        backendKeywords: backendTerms(input.keywords, `${name} ${primary ?? ""} ${material} ${color}`, input.prohibitedClaims, limits.backendKeywordsMaxBytes),
      }
    : {
        title: limit(`${name} – ${material}, ${color}`, limits.titleMaxLength),
        bullets: [
          ...features.slice(0, 3).map((entry, i) => (i === 1 && input.prohibitedClaims[0] ? `${headline(entry.fact)} – ${input.prohibitedClaims[0]}. ${entry.fact}` : bullet(entry))),
        ].map((text) => limit(text, limits.bulletMaxLength)),
        description: limit(`The ${name} in ${color.toLowerCase()}. ${features[0]?.fact ?? ""}`.trim(), limits.descriptionMaxLength),
        backendKeywords: backendTerms(input.keywords.slice(0, 2), `${name} ${material} ${color}`, input.prohibitedClaims, limits.backendKeywordsMaxBytes),
      };
  return groundedDraft(input.live, listing, input.facts);
}

/** The reviewer: each criterion scored from what the draft does, with a finding for each gap. */
export function standInReview(input: ReviewInput): ReviewOutput {
  const { listing, claims } = input.draft;
  const title = listing.title.toLowerCase();
  const text = [listing.title, ...listing.bullets, listing.backendKeywords].join(" ").toLowerCase();
  const words = new Set(text.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean));
  // A keyword that needs promotional words isn't a gap: the copy may not use them.
  const keywords = input.keywords.filter((keyword) => !keyword.toLowerCase().split(/\s+/).some((word) => PROMOTIONAL_WORDS.has(word)));
  const [primary] = keywords;
  const covered = keywords.filter((keyword) => keyword.toLowerCase().split(/\s+/).every((word) => words.has(word)));
  const coverage = keywords.length > 0 ? covered.length / keywords.length : 1;
  const primaryInTitle = !primary || primary.toLowerCase().split(/\s+/).every((word) => title.includes(word));
  const cited = new Set(claims.map((claim) => claim.path));
  const uncited = [...listing.bullets.map((_, i) => `bullets.${i}`), "description"].filter((path) => !cited.has(path as ListingCopyPath));
  const fact = (ref: string) => input.facts.find((entry) => entry.ref === ref)?.fact.toLowerCase() ?? "";
  const statedAttributes = ["material", "color"].filter((ref) => fact(ref) && text.includes(fact(ref))).length;
  const brand = fact("brand");

  const findings: ReviewOutput["findings"] = [];
  if (!primaryInTitle) findings.push({ criterion: "keyword_coverage", severity: "error", message: `Put "${primary}" near the front of the title.` });
  if (coverage < 1) findings.push({ criterion: "keyword_coverage", severity: "warning", message: `Work ${keywords.filter((keyword) => !covered.includes(keyword)).map((keyword) => `"${keyword}"`).join(", ")} into the bullets or backend search terms.` });
  if (listing.bullets.length < LISTING_LIMITS.bulletMaxCount) {
    findings.push({ criterion: "conversion_copy", severity: "warning", message: `Use all ${LISTING_LIMITS.bulletMaxCount} bullets, one distinct benefit each, and end with what's in the box.` });
  }
  if (listing.description.length < 200) findings.push({ criterion: "conversion_copy", severity: "warning", message: "Expand the description to cover every feature and what's included." });
  if (uncited.length > 0) findings.push({ criterion: "grounding", severity: "error", message: `Cite the facts behind ${uncited.join(", ")}.` });
  if (statedAttributes < 2) findings.push({ criterion: "attributes", severity: "info", message: "State the material and color in the copy." });

  const scores: ListingRubricScores = {
    keyword_coverage: primaryInTitle ? Math.round(6 + 4 * coverage) : Math.round(3 + 3 * coverage),
    grounding: uncited.length === 0 ? 10 : 6,
    conversion_copy: Math.min(10, Math.round((listing.bullets.length / LISTING_LIMITS.bulletMaxCount) * 8) + (listing.description.length >= 200 ? 2 : 0)),
    title_structure: (brand && title.startsWith(brand) ? 4 : 3) + (primaryInTitle ? 5 : 2),
    attributes: 7 + statedAttributes,
    voice: /!/.test([listing.title, ...listing.bullets, listing.description].join(" ")) ? 6 : 9,
  };
  const summary = findings.some((finding) => finding.severity !== "info")
    ? "Grounded copy with gaps in keyword placement and coverage of the product."
    : "Strong, grounded listing that covers the keywords and the product.";
  return { scores, summary, findings };
}

/** A draft's account of itself: a reason for each changed path, and a claim for each fact it quotes. */
function groundedDraft(live: ListingCopy, listing: ListingCopy, sheet: readonly FactSheetEntry[]): ListingDraft {
  const changes = changedListingPaths(live, listing).map((path) => ({ path, reason: REASONS[path.startsWith("bullets.") ? "bullets" : (path as keyof typeof REASONS)] }));
  const paths: ListingCopyPath[] = ["title", ...listing.bullets.map((_, i) => `bullets.${i}` as ListingCopyPath), "description"];
  const claims = paths.flatMap((path) => {
    const text = listingText(listing, path);
    return sheet.flatMap(({ ref, fact }) => {
      const words = fact.replace(/\.$/, "");
      const at = text.toLowerCase().indexOf(words.toLowerCase());
      return ref === "brand" || at < 0 ? [] : [{ path, text: text.slice(at, at + words.length), facts: [ref] }];
    });
  });
  return { listing, changes, claims };
}

const REASONS = {
  title: "Leads with the product and the main keyword, then the details shoppers filter by.",
  bullets: "One distinct benefit per bullet, from the product's features.",
  description: "Covers the product's features and what's in the box.",
  backendKeywords: "Adds target keywords the copy doesn't use yet.",
} as const;

const SMALL_WORDS = new Set(["a", "an", "the", "for", "and", "or", "of", "in", "on", "to", "with"]);
/** Words only promotional claims are made of. */
const PROMOTIONAL_WORDS = new Set(["best", "top", "#1", "cheapest", "guaranteed"]);
/** Words that make weak bullet headlines on their own ("MADE WITH", "A CONTOURED"). */
const HEADLINE_SKIP = new Set([...SMALL_WORDS, "made", "is", "are", "it", "its", "your", "every"]);

/** "A contoured handle sits securely in hand." → "CONTOURED HANDLE". */
function headline(sentence: string): string {
  const words = sentence.replace(/[.,;:!?]/g, "").split(/\s+/).filter(Boolean);
  const start = words.findIndex((word) => !HEADLINE_SKIP.has(word.toLowerCase()));
  const [first, second, third] = words.slice(Math.max(0, start));
  const small = (word: string | undefined) => word === undefined || SMALL_WORDS.has(word.toLowerCase());
  const picked = !small(second) ? [first, second] : second !== undefined && !small(third) ? [first, second, third] : [first];
  return picked.join(" ").toUpperCase();
}

/** The keyword's words the name lacks: "mixing bowl set for gym" on "Mixing Bowl Set" is "for gym". */
function missingWords(keyword: string, name: string): string {
  const have = new Set(name.toLowerCase().split(/\s+/));
  const missing = keyword.split(/\s+/).filter((word) => SMALL_WORDS.has(word) || !have.has(word.toLowerCase()));
  return missing.some((word) => !SMALL_WORDS.has(word)) ? missing.join(" ") : keyword;
}

/** Keyword words the title doesn't have, without prohibited words, within the byte limit. */
function backendTerms(keywords: readonly string[], title: string, prohibited: readonly string[], maxBytes: number): string {
  const taken = new Set(title.toLowerCase().split(/[^\p{L}\p{N}'-]+/u));
  const banned = new Set(prohibited.flatMap((phrase) => phrase.toLowerCase().split(/\s+/)));
  const words: string[] = [];
  for (const word of new Set(keywords.join(" ").toLowerCase().split(/\s+/).filter(Boolean))) {
    if (taken.has(word) || banned.has(word) || SMALL_WORDS.has(word)) continue;
    if (utf8ByteLength([...words, word].join(" ")) > maxBytes) break;
    words.push(word);
  }
  return words.join(" ");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function limit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
