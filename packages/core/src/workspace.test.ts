import { describe, expect, it } from "vitest";
import { AutonomyLevelSchema } from "./autonomy";
import { SellerAccountSchema, WorkspaceSchema } from "./workspace";

describe("WorkspaceSchema", () => {
  it("accepts a valid workspace", () => {
    expect(WorkspaceSchema.parse({ id: "ws_1", name: "Acme" })).toEqual({ id: "ws_1", name: "Acme" });
  });

  it("rejects an empty name", () => {
    expect(WorkspaceSchema.safeParse({ id: "ws_1", name: "" }).success).toBe(false);
  });
});

describe("SellerAccountSchema", () => {
  it("rejects an unknown marketplace", () => {
    const result = SellerAccountSchema.safeParse({
      id: "sa_1",
      workspaceId: "ws_1",
      name: "Acme US",
      marketplace: "XX",
    });
    expect(result.success).toBe(false);
  });
});

describe("AutonomyLevelSchema", () => {
  it("only allows L0–L3", () => {
    expect(AutonomyLevelSchema.options).toEqual(["L0", "L1", "L2", "L3"]);
    expect(AutonomyLevelSchema.safeParse("L4").success).toBe(false);
  });
});
