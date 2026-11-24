import { ListingSubmissionSchema, type ListingSubmission, type ListingSubmissionIssue } from "@app/core";
import { z } from "zod";
import type { ListingIssue, ListingsItem, ListingsSubmission } from "./listings-items";

// A new listing's life on Amazon after it is submitted: Amazon's answer to the put, then what its
// notifications and the listing itself say until shoppers can find it.

/** Amazon's issue category for a listing the seller needs approval (brand, category) to create. */
export const APPROVAL_ISSUE_CATEGORY = "QUALIFICATION_REQUIRED";

/** Issues that say the seller needs Amazon's approval before this listing can exist. */
export function approvalIssues(issues: readonly ListingIssue[] = []): ListingIssue[] {
  return issues.filter((issue) => issue.severity === "ERROR" && issue.categories.includes(APPROVAL_ISSUE_CATEGORY));
}

/** Amazon's issues for one marketplace, as the submission records them. */
export function submissionIssues(issues: readonly ListingIssue[] = [], marketplaceId: string): ListingSubmissionIssue[] {
  return issues
    .filter((issue) => issue.marketplaceIds === undefined || issue.marketplaceIds.includes(marketplaceId))
    .map(({ code, message, severity, attributeNames }) => ({ code, message, severity, ...(attributeNames ? { attributeNames } : {}) }));
}

/**
 * The submission as Amazon answered the put: accepted for processing, or invalid. Keyed by the SKU
 * that was put, which is what notifications name (the sandbox answers with a canned one).
 */
export function submittedListing(answer: ListingsSubmission, { sku, marketplaceId, at }: { sku: string; marketplaceId: string; at: string }): ListingSubmission {
  return ListingSubmissionSchema.parse({
    sku,
    marketplaceId,
    submissionId: answer.submissionId,
    status: answer.status === "ACCEPTED" ? "accepted" : "invalid",
    issues: submissionIssues(answer.issues, marketplaceId),
    submittedAt: at,
    updatedAt: at,
  });
}

/**
 * The submission brought up to date from the listing as Amazon holds it now: live once it has an ASIN,
 * shoppers can find it and nothing is in error; has_issues while an error keeps it back.
 */
export function trackedListing(submission: ListingSubmission, item: ListingsItem, at: string): ListingSubmission {
  const { marketplaceId } = submission;
  const summary = item.summaries?.find((candidate) => candidate.marketplaceId === marketplaceId);
  const issues = submissionIssues(item.issues, marketplaceId);
  const asin = summary?.asin ?? submission.asin;
  const errors = issues.some((issue) => issue.severity === "ERROR");
  const findable = summary !== undefined && (summary.status.includes("BUYABLE") || summary.status.includes("DISCOVERABLE"));
  return ListingSubmissionSchema.parse({
    ...submission,
    status: errors ? "has_issues" : asin && findable ? "live" : "accepted",
    ...(asin ? { asin } : {}),
    issues,
    updatedAt: at,
  });
}

/** Amazon's notifications about a listing changing, as the SP-API Notifications API sends them. */
export const LISTINGS_ITEM_NOTIFICATION_TYPES = ["LISTINGS_ITEM_ISSUES_CHANGE", "LISTINGS_ITEM_STATUS_CHANGE"] as const;

const ListingsItemNotificationSchema = z.object({
  NotificationType: z.enum(LISTINGS_ITEM_NOTIFICATION_TYPES),
  Payload: z.looseObject({ SellerId: z.string().min(1), MarketplaceId: z.string().min(1), Sku: z.string().min(1), Asin: z.string().optional() }),
});

/** Which listing changed. The rest is read from the listing itself. */
export type ListingsItemChange = {
  notificationType: (typeof LISTINGS_ITEM_NOTIFICATION_TYPES)[number];
  sellerId: string;
  marketplaceId: string;
  sku: string;
};

/**
 * Reads a listings item notification, bare or in the EventBridge envelope it arrives in (`detail`).
 * Undefined for any other notification.
 */
export function listingsItemChange(message: unknown): ListingsItemChange | undefined {
  const body = typeof message === "object" && message !== null && "detail" in message ? message.detail : message;
  const parsed = ListingsItemNotificationSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const { NotificationType, Payload } = parsed.data;
  return { notificationType: NotificationType, sellerId: Payload.SellerId, marketplaceId: Payload.MarketplaceId, sku: Payload.Sku };
}
