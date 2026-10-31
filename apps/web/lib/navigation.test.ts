import { describe, expect, it } from "vitest";
import { allNav, getNavItem, isNavItemActive } from "./navigation";

describe("isNavItemActive", () => {
  it("matches the exact route and nested routes", () => {
    expect(isNavItemActive("/listings", "/listings")).toBe(true);
    expect(isNavItemActive("/listings/B0123", "/listings")).toBe(true);
  });

  it("does not match routes that only share a prefix", () => {
    expect(isNavItemActive("/listings-archive", "/listings")).toBe(false);
    expect(isNavItemActive("/dashboard", "/listings")).toBe(false);
  });
});

describe("navigation", () => {
  it("has the six shell sections in order", () => {
    expect(allNav.map((item) => item.title)).toEqual([
      "Dashboard",
      "Approvals",
      "Listings",
      "Campaigns",
      "Reports",
      "Settings",
    ]);
  });

  it("looks up items by href", () => {
    expect(getNavItem("/approvals").title).toBe("Approvals");
    expect(() => getNavItem("/nope")).toThrow();
  });
});
