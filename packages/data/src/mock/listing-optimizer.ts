import {
  LISTING_LIMITS,
  RubricCriterionSchema,
  checkListingCompliance,
  overallScore,
  utf8ByteLength,
  type AgentRunStep,
  type ComplianceCheck,
  type ListingCopy,
  type Product,
  type ProductFacts,
  type ReviewReport,
  type RubricScores,
} from "@app/core";

/** Seconds each step takes in the simulated run, in order. */
const STEP_SECONDS = [7, 2, 5, 7, 4, 1] as const;

/** Round 1 lands at 71 and round 2 at 88 (the overall is derived from six 1–5 scores). */
const ROUND_1_SCORES: RubricScores = { title: 3, bullets: 4, description: 4, keywords: 5, factual_accuracy: 5, compliance: 2 };
const ROUND_2_SCORES: RubricScores = { title: 5, bullets: 4, description: 3, keywords: 5, factual_accuracy: 5, compliance: 5 };

export type OptimizerPlan = {
  steps: AgentRunStep[];
  /** The revised draft that becomes the proposal. */
  final: ListingCopy;
  review: { scores: RubricScores; overall: number; report: ReviewReport };
  /** Target keywords the final copy has that the live copy lacks. */
  keywordsGained: string[];
};

type PlanInput = {
  runId: string;
  product: Product;
  facts: ProductFacts;
  live: ListingCopy;
  /** Epoch ms the run starts at. */
  startedAt: number;
};

/**
 * The Phase 1 stand-in for the listing optimizer: draft, compliance check, two reviewer rounds and a
 * revision, all derived from ProductFacts. Draft 1 has deliberate gaps (a prohibited claim, a title
 * without the main keyword, a repeated bullet) so the review loop has something to fix.
 */
export function planListingOptimizerRun({ runId, product, facts, live, startedAt }: PlanInput): OptimizerPlan {
  // The bare product name, without the color, material or "for …" tail an earlier rewrite added.
  const name = product.title.split(/,| – | for /)[0]?.trim() || product.title;
  const noun = name.startsWith(`${product.brand} `) ? name.slice(product.brand.length + 1) : name;
  const keywords = facts.targetKeywords.length > 0 ? facts.targetKeywords : [noun.toLowerCase()];
  // The keyword to work into the title: the first one the product name doesn't already contain.
  const nameWords = new Set(name.toLowerCase().split(/\s+/));
  const primary = keywords.find((keyword) => !name.toLowerCase().includes(keyword)) ?? keywords[0]!;
  // Only the words the name lacks, e.g. "mixing bowl set for gym" on "Mixing Bowl Set" adds "for Gym".
  const focusWords = primary.split(/\s+/).filter((word) => SMALL_WORDS.has(word) || !nameWords.has(word));
  const titleFocus = focusWords.some((word) => !SMALL_WORDS.has(word))
    ? focusWords.map((word) => (SMALL_WORDS.has(word) ? word : titleCase(word))).join(" ")
    : "";
  const claim = facts.prohibitedClaims[0];
  const features = facts.features.length > 0 ? facts.features : [`Made from ${facts.material.toLowerCase()}.`];
  const feature = (i: number) => features[i % features.length]!;
  const bullet = (i: number) => `${headline(feature(i))} – ${feature(i)}`;
  const components = facts.includedComponents.join(", ");

  const draft1: ListingCopy = {
    title: limit(`${name} – ${facts.material}, ${facts.color}`, LISTING_LIMITS.titleMaxLength),
    bullets: [
      bullet(0),
      claim ? `${headline(feature(1))} – ${claim}. ${feature(1)}` : bullet(1),
      bullet(2),
      bullet(1),
    ],
    description: `The ${product.brand} ${noun.toLowerCase()} in ${facts.color.toLowerCase()}. ${feature(0)}`,
    backendKeywords: backendTerms(keywords.slice(0, 3)),
  };

  const draft2: ListingCopy = {
    title: limit(
      titleFocus
        ? `${name} ${titleFocus} – ${facts.material}, ${facts.color}`
        : `${name} – ${titleCase(headline(feature(0)).toLowerCase())}, ${facts.material}, ${facts.color}`,
      LISTING_LIMITS.titleMaxLength,
    ),
    bullets: [bullet(0), bullet(1), bullet(2), bullet(3), `WHAT'S INCLUDED – ${components}.`],
    description: limit(
      [
        `Meet the ${product.brand} ${noun.toLowerCase()}, made from ${facts.material.toLowerCase()} in ${facts.color.toLowerCase()}.`,
        ...features,
        `In the box: ${components.toLowerCase()}.`,
      ].join(" "),
      LISTING_LIMITS.descriptionMaxLength,
    ),
    backendKeywords: backendTerms(keywords),
  };

  const checks = checkListingCompliance(draft1, facts);
  const fixes = [
    ...(claim ? [{ criterion: "compliance" as const, severity: "error" as const, message: `Remove "${claim}"; it is not backed by ProductFacts.` }] : []),
    { criterion: "title" as const, severity: "warning" as const, message: `Put "${primary}" near the front of the title.` },
    { criterion: "bullets" as const, severity: "warning" as const, message: "Bullets 2 and 4 repeat the same benefit; use all five bullets and list what's in the box." },
    { criterion: "description" as const, severity: "info" as const, message: "The description is thin; cover every feature and what's included." },
  ];
  const round2Findings = [{ criterion: "description" as const, severity: "info" as const, message: "Could add care instructions." }];
  const overall1 = overallScore(ROUND_1_SCORES);
  const overall2 = overallScore(ROUND_2_SCORES);

  const liveText = [live.title, ...live.bullets, live.backendKeywords].join(" ").toLowerCase();
  const finalText = [draft2.title, ...draft2.bullets, draft2.backendKeywords].join(" ").toLowerCase();
  const keywordsGained = keywords.filter((keyword) => !liveText.includes(keyword) && finalText.includes(keyword));

  const texts = {
    draft1: [
      `Reading ProductFacts: ${facts.material}, ${facts.color}, ${features.length} features, ${facts.includedComponents.length} included items.`,
      `Target keywords: ${keywords.slice(0, 4).join(", ")}.`,
      "",
      copyText(draft1),
    ].join("\n"),
    compliance: [
      `Running ${checks.length} guardrail checks on draft 1.`,
      ...checks.map((check) => `${CHECK_MARK[check.status]} ${check.label}${check.detail ? ` – ${check.detail}` : ""}`),
      "",
      complianceSummary(checks),
    ].join("\n"),
    review1: [
      "Scoring draft 1 against the rubric.",
      scoreLine(ROUND_1_SCORES),
      `Overall ${overall1}/100. Not ready to propose.`,
      "",
      "Fix list",
      ...fixes.map((fix, i) => `${i + 1}. ${fix.message}`),
    ].join("\n"),
    draft2: [
      `Applying ${fixes.length} fixes from the reviewer.`,
      ...(claim ? [`– Removed "${claim}".`] : []),
      `– Moved "${primary}" to the front of the title.`,
      "– Rewrote the bullets around five distinct benefits, ending with what's in the box.",
      "– Expanded the description to cover every feature.",
      "",
      copyText(draft2),
    ].join("\n"),
    review2: [
      "Re-scoring the revised draft.",
      scoreLine(ROUND_2_SCORES),
      `Overall ${overall2}/100. Compliance passes. Ready for a human decision.`,
      ...round2Findings.map((finding) => `Note: ${finding.message}`),
    ].join("\n"),
    awaiting: "Created a listing update proposal. Nothing changes on Amazon until a member approves it.",
  };

  let clock = startedAt;
  const timed = (i: number) => {
    const from = clock;
    clock += STEP_SECONDS[i]! * 1000;
    return { id: `${runId}_s${i + 1}`, startedAt: new Date(from).toISOString(), finishedAt: new Date(clock).toISOString() };
  };

  const steps: AgentRunStep[] = [
    { ...timed(0), kind: "draft", agent: "listing_writer", round: 1, title: "Optimizer draft", text: texts.draft1, listing: draft1 },
    { ...timed(1), kind: "compliance_check", title: "Compliance check", text: texts.compliance, checks },
    {
      ...timed(2),
      kind: "review",
      agent: "listing_reviewer",
      round: 1,
      title: "Reviewer round 1",
      text: texts.review1,
      scores: ROUND_1_SCORES,
      overall: overall1,
      findings: fixes,
    },
    { ...timed(3), kind: "draft", agent: "listing_writer", round: 2, title: "Revised draft", text: texts.draft2, listing: draft2 },
    {
      ...timed(4),
      kind: "review",
      agent: "listing_reviewer",
      round: 2,
      title: "Reviewer round 2",
      text: texts.review2,
      scores: ROUND_2_SCORES,
      overall: overall2,
      findings: round2Findings,
    },
    { ...timed(5), kind: "awaiting_approval", title: "Awaiting approval", text: texts.awaiting },
  ];

  return {
    steps,
    final: draft2,
    review: {
      scores: ROUND_2_SCORES,
      overall: overall2,
      report: { summary: "Strong listing after one revision; ready to publish.", findings: round2Findings },
    },
    keywordsGained,
  };
}

const CHECK_MARK: Record<ComplianceCheck["status"], string> = { pass: "✓", warn: "!", fail: "✗" };

function complianceSummary(checks: ComplianceCheck[]): string {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  if (failed === 0 && warned === 0) return "All checks pass.";
  return `${failed} blocking, ${warned} ${warned === 1 ? "warning" : "warnings"}. Sending to the reviewer with the results attached.`;
}

function scoreLine(scores: RubricScores): string {
  return RubricCriterionSchema.options.map((criterion) => `${criterion.replace("_", " ")} ${scores[criterion]}/5`).join(" · ");
}

function copyText(copy: ListingCopy): string {
  return [
    "Title",
    copy.title,
    "",
    "Bullets",
    ...copy.bullets.map((bullet) => `• ${bullet}`),
    "",
    "Description",
    copy.description,
    "",
    "Backend search terms",
    copy.backendKeywords,
  ].join("\n");
}

/** "Dishwasher-safe parts come apart in seconds." → "DISHWASHER-SAFE PARTS" */
const SMALL_WORDS = new Set(["a", "an", "the", "for", "and", "or", "of", "in", "on", "to", "with"]);
/** Words that make weak bullet headlines on their own ("MADE WITH", "A CONTOURED"). */
const HEADLINE_SKIP = new Set([...SMALL_WORDS, "made", "is", "are", "it", "its", "your", "every"]);

/**
 * "A contoured handle sits securely in hand." → "CONTOURED HANDLE"; "Ready to use in minutes." →
 * "READY TO USE". Skips weak leading words, then keeps two words, or three when the middle one is small.
 */
function headline(sentence: string): string {
  const words = sentence.replace(/[.,;:!?]/g, "").split(/\s+/).filter(Boolean);
  const start = words.findIndex((word) => !HEADLINE_SKIP.has(word.toLowerCase()));
  const [first, second, third] = words.slice(Math.max(0, start));
  const small = (word: string | undefined) => word === undefined || SMALL_WORDS.has(word.toLowerCase());
  const picked = !small(second) ? [first, second] : second !== undefined && !small(third) ? [first, second, third] : [first];
  return picked.join(" ").toUpperCase();
}

function backendTerms(keywords: string[]): string {
  const words: string[] = [];
  for (const word of new Set(keywords.join(" ").toLowerCase().split(/\s+/).filter(Boolean))) {
    if (utf8ByteLength([...words, word].join(" ")) > LISTING_LIMITS.backendKeywordsMaxBytes) break;
    words.push(word);
  }
  return words.join(" ");
}

function titleCase(value: string): string {
  return value.replace(/(^|\s)(\w)/g, (_, space: string, char: string) => space + char.toUpperCase());
}

function limit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
