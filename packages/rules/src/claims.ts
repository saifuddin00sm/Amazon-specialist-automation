import { RESTRICTED_TERMS, type Violation, type ViolationSeverity } from "@app/core";
import { escapeRegExp, wordEdge } from "./text";

export type ProhibitedClaim = {
  /** Matched case-insensitively as whole words; a space or hyphen in it matches either, or several spaces. */
  phrase: string;
  /** Why it is prohibited, shown to the user. */
  reason: string;
  /** Defaults to error. */
  severity?: ViolationSeverity;
};

const PROMOTIONAL = "Promotional language isn't allowed in listing copy.";
const MEDICAL = "Disease and medical claims aren't allowed without FDA approval.";
const PESTICIDE = "Pesticide claims need EPA registration.";
const ENVIRONMENTAL = "Environmental claims need a certification Amazon recognizes.";

/** Claims Amazon prohibits in listing copy for every product. Pass your own list to checkClaims to change it. */
export const DEFAULT_PROHIBITED_CLAIMS: readonly ProhibitedClaim[] = [
  ...RESTRICTED_TERMS.map((phrase) => ({ phrase, reason: PROMOTIONAL })),
  { phrase: "cure", reason: MEDICAL },
  { phrase: "cures", reason: MEDICAL },
  { phrase: "heals", reason: MEDICAL },
  { phrase: "FDA approved", reason: MEDICAL },
  { phrase: "clinically proven", reason: MEDICAL },
  // A hyphen is optional, so these also catch "antibacterial" and "anti bacterial".
  { phrase: "anti-bacterial", reason: PESTICIDE },
  { phrase: "anti-microbial", reason: PESTICIDE },
  { phrase: "anti-viral", reason: PESTICIDE },
  { phrase: "anti-fungal", reason: PESTICIDE },
  { phrase: "kills germs", reason: PESTICIDE },
  { phrase: "kills bacteria", reason: PESTICIDE },
  { phrase: "kills viruses", reason: PESTICIDE },
  { phrase: "non-toxic", reason: PESTICIDE },
  { phrase: "eco-friendly", reason: ENVIRONMENTAL },
  { phrase: "biodegradable", reason: ENVIRONMENTAL },
];

/** Every prohibited claim in the text, one violation per place it appears, in order. */
export function checkClaims(text: string, claims: readonly ProhibitedClaim[] = DEFAULT_PROHIBITED_CLAIMS): Violation[] {
  const violations: Violation[] = [];
  for (const claim of claims) {
    const phrase = claim.phrase.trim();
    if (phrase.length === 0) continue;
    for (const found of text.matchAll(claimPattern(phrase))) {
      violations.push({
        rule: "prohibited_claim",
        severity: claim.severity ?? "error",
        message: `"${found[0]}" is a prohibited claim. ${claim.reason}`,
        match: found[0],
        index: found.index,
      });
    }
  }
  return violations.sort((a, b) => a.index! - b.index!);
}

function claimPattern(phrase: string): RegExp {
  const body = phrase
    .split(/([\s-]+)/)
    .map((part) => (/^[\s-]+$/.test(part) ? (part.includes("-") ? "[\\s-]*" : "[\\s-]+") : escapeRegExp(part)))
    .join("");
  return new RegExp(`${wordEdge(phrase[0]!, "before")}${body}${wordEdge(phrase.at(-1)!, "after")}`, "giu");
}
