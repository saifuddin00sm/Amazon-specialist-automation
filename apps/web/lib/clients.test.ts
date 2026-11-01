import { describe, expect, it } from "vitest";
import { clientHealth, type HealthInput } from "./clients";

const healthy: HealthInput = {
  sales: { current: 10_000, previous: 9_500 },
  acos: 0.28,
  targetAcos: 0.3,
  listingScore: 78,
  pending: 2,
  highRisk: 0,
  oldestPendingAt: "2026-10-31T09:00:00.000Z",
  hasData: true,
  now: "2026-11-01T09:00:00.000Z",
};

describe("clientHealth", () => {
  it("is healthy when nothing trips", () => {
    expect(clientHealth(healthy)).toEqual({ status: "healthy", issues: [] });
  });

  it("needs attention for one issue and is at risk for two", () => {
    expect(clientHealth({ ...healthy, acos: 0.4 })).toEqual({ status: "attention", issues: ["ACoS 40% is over the 30% target."] });
    expect(clientHealth({ ...healthy, acos: 0.32 }).status).toBe("healthy");
    const risky = clientHealth({ ...healthy, sales: { current: 8_000, previous: 10_000 }, highRisk: 1, oldestPendingAt: "2026-10-27T09:00:00.000Z" });
    expect(risky).toEqual({
      status: "at_risk",
      issues: ["Sales are down 20% on the 30 days before.", "1 high-risk proposal is waiting.", "A proposal has waited 5 days."],
    });
  });

  it("flags weak listings and accounts without data", () => {
    expect(clientHealth({ ...healthy, listingScore: 52 }).issues).toEqual(["Listings average 52/100."]);
    expect(clientHealth({ ...healthy, hasData: false })).toEqual({ status: "attention", issues: ["No data from Amazon yet."] });
  });
});
