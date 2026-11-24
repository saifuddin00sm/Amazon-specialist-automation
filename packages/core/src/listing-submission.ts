import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

/**
 * Where a new listing is on Amazon after its proposal was approved and submitted:
 *
 *   invalid     Amazon refused the submission, or it couldn't be sent; nothing was listed.
 *   accepted    Amazon took it and is processing it.
 *   has_issues  Amazon reported errors that keep it from shoppers.
 *   live        Shoppers can find it: Amazon lists it with an ASIN and no errors.
 */
export const ListingSubmissionStatusSchema = z.enum(["invalid", "accepted", "has_issues", "live"]);
export type ListingSubmissionStatus = z.infer<typeof ListingSubmissionStatusSchema>;

/** One problem Amazon reported with the listing, in Amazon's words. */
export const ListingSubmissionIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["ERROR", "WARNING", "INFO"]),
  attributeNames: z.array(z.string()).optional(),
});
export type ListingSubmissionIssue = z.infer<typeof ListingSubmissionIssueSchema>;

/** A new listing as submitted to Amazon (putListingsItem), kept up to date from listing notifications. */
export const ListingSubmissionSchema = z.object({
  sku: z.string().min(1).max(40),
  marketplaceId: z.string().min(1),
  /** Amazon's id for the submission, for support cases. Absent when the submission never reached Amazon. */
  submissionId: z.string().min(1).optional(),
  status: ListingSubmissionStatusSchema,
  /** Set once Amazon assigns one. */
  asin: z.string().min(1).optional(),
  issues: z.array(ListingSubmissionIssueSchema),
  submittedAt: IsoDateTimeSchema,
  /** When Amazon's latest word on it was recorded. */
  updatedAt: IsoDateTimeSchema
});
export type ListingSubmission = z.infer<typeof ListingSubmissionSchema>;

/** Statuses after which nothing more is expected from Amazon. */
export function isSubmissionSettled(status: ListingSubmissionStatus): boolean {
  return status === "invalid" || status === "live";
}

/** True when Amazon's latest word changes what the submission records. */
export function submissionChanged(before: ListingSubmission, after: ListingSubmission): boolean {
  const comparable = (submission: ListingSubmission) => JSON.stringify(ListingSubmissionSchema.parse({ ...submission, updatedAt: submission.submittedAt }));
  return comparable(before) !== comparable(after);
}
