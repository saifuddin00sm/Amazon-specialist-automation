import { describe, expect, it } from "vitest";
import sandbox from "./fixtures/sandbox-responses.json";
import { RestrictionListSchema, applicableRestrictions, restrictionMessage } from "./listings-restrictions";

const US = "ATVPDKIKX0DER";
const restrictions = RestrictionListSchema.parse(sandbox.getListingsRestrictions_200_0);

describe("applicableRestrictions", () => {
  it("keeps restrictions for the marketplace and condition, or for every condition", () => {
    expect(applicableRestrictions(restrictions, { marketplaceId: US, conditionType: "used_acceptable" })).toHaveLength(1);
    expect(applicableRestrictions(restrictions, { marketplaceId: US, conditionType: "new_new" })).toEqual([]);
    expect(applicableRestrictions(restrictions, { marketplaceId: "A2EUQ1WTGCTBG2", conditionType: "used_acceptable" })).toEqual([]);

    const brand = { restrictions: [{ marketplaceId: US, reasons: [{ message: "You need approval to list in this brand.", reasonCode: "APPROVAL_REQUIRED" }] }] };
    expect(applicableRestrictions(brand, { marketplaceId: US, conditionType: "new_new" })).toHaveLength(1);
  });
});

describe("restrictionMessage", () => {
  it("says why, in Amazon's words, and where to ask for approval", () => {
    expect(restrictionMessage(restrictions.restrictions)).toBe(
      "Amazon restricts this ASIN: You cannot list the product in this condition. Request Approval via Seller Central: https://sellercentral.amazon.com/hz/approvalrequest/restrictions/approve?asin=B0000ASIN1",
    );
    expect(restrictionMessage([{ marketplaceId: US, reasons: [{ message: "Not eligible", reasonCode: "NOT_ELIGIBLE" }] }])).toBe(
      "Amazon restricts this ASIN: Not eligible.",
    );
  });
});
