import type { Prompt } from "../prompt";
import campaignOptimizerPlanV1 from "./campaign-optimizer.plan.v1";
import campaignStrategistPlanV1 from "./campaign-strategist.plan.v1";
import listingCreatorAttributesV1 from "./listing-creator.attributes.v1";
import listingReviewerReviewV1 from "./listing-reviewer.review.v1";
import listingWriterCreateV1 from "./listing-writer.create.v1";
import listingWriterCreateV2 from "./listing-writer.create.v2";
import listingWriterRewriteV1 from "./listing-writer.rewrite.v1";
import listingWriterRewriteV2 from "./listing-writer.rewrite.v2";

/**
 * The prompts agents call, each at the version in use. Moving one to a new version is a new file
 * (<id>.v<n>.ts) imported here; the old file stays, so runs that logged it can still be traced.
 */
export const PROMPTS = {
  listingRewrite: listingWriterRewriteV2,
  listingCreate: listingWriterCreateV2,
  listingReview: listingReviewerReviewV1,
  listingAttributes: listingCreatorAttributesV1,
  campaignOptimize: campaignOptimizerPlanV1,
  campaignStrategy: campaignStrategistPlanV1,
} as const;

/** Every prompt version, in use or not. */
export const PROMPT_VERSIONS: readonly Prompt[] = [
  listingWriterRewriteV1,
  listingWriterRewriteV2,
  listingWriterCreateV1,
  listingWriterCreateV2,
  listingReviewerReviewV1,
  listingCreatorAttributesV1,
  campaignOptimizerPlanV1,
  campaignStrategistPlanV1,
];
