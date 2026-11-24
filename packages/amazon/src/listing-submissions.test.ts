import { describe, expect, it } from "vitest";
import sandbox from "./fixtures/sandbox-responses.json";
import { approvalIssues, listingsItemChange, submittedListing, trackedListing } from "./listing-submissions";
import { ListingsItemSchema, ListingsSubmissionSchema, type ListingsItem } from "./listings-items";

const US = "ATVPDKIKX0DER";
const at = "2026-11-23T10:00:00.000Z";
const later = "2026-11-23T12:00:00.000Z";

describe("submittedListing", () => {
  it("records an accepted put, and an invalid one with Amazon's issues", () => {
    const accepted = submittedListing(ListingsSubmissionSchema.parse(sandbox.putListingsItem_200_0), { sku: "GM-ZDPI-9B4E", marketplaceId: US, at });
    expect(accepted).toEqual({
      sku: "GM-ZDPI-9B4E",
      marketplaceId: US,
      submissionId: "f1dc2914-75dd-11ea-bc55-0242ac130003",
      status: "accepted",
      issues: [],
      submittedAt: at,
      updatedAt: at,
    });

    const invalid = submittedListing(ListingsSubmissionSchema.parse(sandbox.putListingsItem_200_2), { sku: "NL-0001", marketplaceId: US, at });
    expect(invalid.status).toBe("invalid");
    expect(invalid.issues.map((issue) => [issue.code, issue.attributeNames])).toEqual([
      ["90220", ["condition_type"]],
      ["90000900", ["fake_attribute"]],
    ]);
  });
});

describe("trackedListing", () => {
  const submitted = submittedListing(ListingsSubmissionSchema.parse(sandbox.putListingsItem_200_0), { sku: "GM-ZDPI-9B4E", marketplaceId: US, at });
  const item = (overrides: Partial<ListingsItem>): ListingsItem => ListingsItemSchema.parse({ ...sandbox.getListingsItem_200_0, ...overrides });

  it("holds the listing back while Amazon reports errors in its marketplace", () => {
    const tracked = trackedListing(submitted, item({}), later);
    expect(tracked).toMatchObject({ status: "has_issues", asin: "B071VG5N9D", submittedAt: at, updatedAt: later });
    expect(tracked.issues.map((issue) => issue.code)).toEqual(["90220", "18027", "99300", "18155", "18742"]);
  });

  it("goes live once Amazon lists it with an ASIN and no errors", () => {
    const clean = item({ issues: [{ code: "1", message: "Add more images.", severity: "WARNING", categories: [] }] });
    expect(trackedListing(submitted, clean, later)).toMatchObject({ status: "live", asin: "B071VG5N9D" });
    // Errors in another marketplace don't hold it back here.
    const elsewhere = item({ issues: [{ code: "2", message: "Missing size.", severity: "ERROR", categories: [], marketplaceIds: ["A2EUQ1WTGCTBG2"] }] });
    expect(trackedListing(submitted, elsewhere, later).status).toBe("live");
  });

  it("stays accepted while Amazon is still processing it", () => {
    expect(trackedListing(submitted, item({ summaries: [], issues: [] }), later)).toMatchObject({ status: "accepted", issues: [] });
  });
});

describe("approvalIssues", () => {
  it("picks errors that need the seller to get Amazon's approval", () => {
    const gated = { code: "8572", message: "You need approval to list in this brand.", severity: "ERROR" as const, categories: ["QUALIFICATION_REQUIRED"] };
    expect(approvalIssues([gated, { ...gated, severity: "WARNING" }, { ...gated, categories: ["MISSING_ATTRIBUTE"] }])).toEqual([gated]);
  });
});

describe("listingsItemChange", () => {
  const notification = {
    NotificationVersion: "1.0",
    NotificationType: "LISTINGS_ITEM_ISSUES_CHANGE",
    PayloadVersion: "1.0",
    EventTime: "2026-11-23T11:00:00.000Z",
    Payload: { SellerId: "A1SELLER000001", MarketplaceId: US, Asin: "B071VG5N9D", Sku: "NL-0001", Severities: ["ERROR"], EnforcementActions: [] },
    NotificationMetadata: { ApplicationId: "app", SubscriptionId: "sub", PublishTime: "2026-11-23T11:00:01.000Z", NotificationId: "n-1" },
  };
  const change = { notificationType: "LISTINGS_ITEM_ISSUES_CHANGE", sellerId: "A1SELLER000001", marketplaceId: US, sku: "NL-0001" };

  it("reads which listing changed, bare or in an EventBridge envelope", () => {
    expect(listingsItemChange(notification)).toEqual(change);
    expect(listingsItemChange({ version: "0", "detail-type": "LISTINGS_ITEM_ISSUES_CHANGE", source: "aws.partner/sellingpartnerapi.amazon.com", detail: notification })).toEqual(change);
  });

  it("ignores other notifications", () => {
    expect(listingsItemChange({ ...notification, NotificationType: "ANY_OFFER_CHANGED" })).toBeUndefined();
    expect(listingsItemChange("not json")).toBeUndefined();
  });
});
