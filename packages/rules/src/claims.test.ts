import { describe, expect, it } from "vitest";
import { checkClaims, DEFAULT_PROHIBITED_CLAIMS, type ProhibitedClaim } from "./claims";

const matches = (text: string, claims?: readonly ProhibitedClaim[]) => checkClaims(text, claims).map((violation) => violation.match);

describe("checkClaims", () => {
  it("passes text without prohibited claims", () => {
    expect(checkClaims("Double-wall stainless steel keeps drinks cold for 24 hours.")).toEqual([]);
  });

  it("finds default claims case-insensitively, with where they are", () => {
    expect(checkClaims("Our BPA-safe bottle is Clinically Proven to hydrate.")).toEqual([
      {
        rule: "prohibited_claim",
        severity: "error",
        message: "\"Clinically Proven\" is a prohibited claim. Disease and medical claims aren't allowed without FDA approval.",
        match: "Clinically Proven",
        index: 23,
      },
    ]);
  });

  it("matches whole words only", () => {
    expect(matches("Secure lid, procured locally.")).toEqual([]);
    expect(matches("A cure for thirst.")).toEqual(["cure"]);
    expect(matches("Rated #10 in style")).toEqual([]);
    expect(matches("Rated #1 in style")).toEqual(["#1"]);
  });

  it("treats spaces and hyphens in a phrase alike, and an optional hyphen as optional", () => {
    expect(matches("Eco friendly, eco-friendly and ecofriendly.")).toEqual(["Eco friendly", "eco-friendly", "ecofriendly"]);
    expect(matches("Kills  germs and kills-bacteria.")).toEqual(["Kills  germs", "kills-bacteria"]);
    expect(matches("Antibacterial, anti-bacterial and anti bacterial.")).toEqual(["Antibacterial", "anti-bacterial", "anti bacterial"]);
  });

  it("reports every occurrence, in order through the text", () => {
    expect(checkClaims("Guaranteed fresh. Biodegradable. Guaranteed.").map(({ match, index }) => [match, index])).toEqual([
      ["Guaranteed", 0],
      ["Biodegradable", 18],
      ["Guaranteed", 33],
    ]);
  });

  it("includes Amazon's promotional terms", () => {
    expect(matches("Best seller! Free shipping on sale today.")).toEqual(["Best seller", "Free shipping", "on sale"]);
  });

  it("uses a configured list in place of the defaults", () => {
    const claims: ProhibitedClaim[] = [{ phrase: "miracle", reason: "Unsubstantiated." }];
    expect(matches("A miracle cure.", claims)).toEqual(["miracle"]);
    expect(checkClaims("A miracle cure.", claims)[0]?.message).toBe('"miracle" is a prohibited claim. Unsubstantiated.');
  });

  it("uses each claim's own severity, error by default", () => {
    const claims: ProhibitedClaim[] = [
      { phrase: "premium", reason: "Vague.", severity: "warning" },
      { phrase: "toxin free", reason: "Unsubstantiated." },
    ];
    expect(checkClaims("Premium, toxin free.", claims).map(({ severity }) => severity)).toEqual(["warning", "error"]);
  });

  it("escapes regular expression characters in a phrase", () => {
    expect(matches("Kills 99.9% of germs, not 9989%.", [{ phrase: "99.9%", reason: "Pesticide claim." }])).toEqual(["99.9%"]);
    expect(matches("(new) formula", [{ phrase: "(new)", reason: "Promotional." }])).toEqual(["(new)"]);
  });

  it("skips blank phrases instead of matching everywhere, and passes an empty list", () => {
    expect(checkClaims("Anything at all.", [{ phrase: "  ", reason: "Oops." }])).toEqual([]);
    expect(checkClaims("Guaranteed.", [])).toEqual([]);
  });

  it("has no duplicate default phrases", () => {
    const phrases = DEFAULT_PROHIBITED_CLAIMS.map(({ phrase }) => phrase.toLowerCase());
    expect(new Set(phrases).size).toBe(phrases.length);
  });
});
