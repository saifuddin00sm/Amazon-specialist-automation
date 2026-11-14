import type { Prompt } from "../prompt";
import campaignOptimizerPlanV1 from "./campaign-optimizer.plan.v1";
import campaignStrategistPlanV1 from "./campaign-strategist.plan.v1";
import listingCreatorAttributesV1 from "./listing-creator.attributes.v1";
import listingReviewerReviewV1 from "./listing-reviewer.review.v1";
import listingWriterCreateV1 from "./listing-writer.create.v1";
import listingWriterRewriteV1 from "./listing-writer.rewrite.v1";

/**
 * The prompts agents call, each at the version in use. Moving one to a new version is a new file
 * (<id>.v<n>.ts) imported here; the old file stays, so runs that logged it can still be traced.
 */
export const PROMPTS = {
  listingRewrite: listingWriterRewriteV1,
  listingCreate: listingWriterCreateV1,
  listingReview: listingReviewerReviewV1,
  listingAttributes: listingCreatorAttributesV1,
  campaignOptimize: campaignOptimizerPlanV1,
  campaignStrategy: campaignStrategistPlanV1,
} as const;

/** Every prompt version, in use or not. */
export const PROMPT_VERSIONS: readonly Prompt[] = [
  listingWriterRewriteV1,
  listingWriterCreateV1,
  listingReviewerReviewV1,
  listingCreatorAttributesV1,
  campaignOptimizerPlanV1,
  campaignStrategistPlanV1,
];
