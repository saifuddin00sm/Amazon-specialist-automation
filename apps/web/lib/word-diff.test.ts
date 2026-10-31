import { describe, expect, it } from "vitest";
import { changeStats, diffWords, sideOf } from "./word-diff";

const join = (segments: { text: string }[]) => segments.map((segment) => segment.text).join("");

describe("diffWords", () => {
  it("returns one equal segment for identical text", () => {
    expect(diffWords("Insulated water bottle", "Insulated water bottle")).toEqual([
      { type: "equal", text: "Insulated water bottle" },
    ]);
  });

  it("marks replaced words", () => {
    expect(diffWords("Insulated water bottle, black", "Insulated steel bottle, black")).toEqual([
      { type: "equal", text: "Insulated " },
      { type: "delete", text: "water" },
      { type: "insert", text: "steel" },
      { type: "equal", text: " bottle, black" },
    ]);
  });

  it("handles inserts at the edges and empty sides", () => {
    expect(diffWords("", "New title")).toEqual([{ type: "insert", text: "New title" }]);
    expect(diffWords("Old title", "")).toEqual([{ type: "delete", text: "Old title" }]);
    expect(diffWords("bottle", "Premium bottle")).toEqual([
      { type: "insert", text: "Premium " },
      { type: "equal", text: "bottle" },
    ]);
  });

  it("rebuilds each side exactly from its segments", () => {
    const before = "Keeps drinks cold for 24 hours.  Dishwasher safe lid.";
    const after = "Keeps drinks icy cold for 24 hours. Dishwasher-safe lid and straw.";
    const segments = diffWords(before, after);
    expect(join(sideOf(segments, "before"))).toBe(before);
    expect(join(sideOf(segments, "after"))).toBe(after);
  });

  it("counts changed words", () => {
    expect(changeStats(diffWords("a b c", "a x y c"))).toEqual({ added: 2, removed: 1 });
  });
});
