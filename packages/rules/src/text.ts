/** A lookaround so a phrase only matches as whole words, where its edge is a letter or digit. */
export function wordEdge(character: string, side: "before" | "after"): string {
  if (!/[\p{L}\p{M}\p{N}]/u.test(character)) return "";
  return side === "before" ? "(?<![\\p{L}\\p{M}\\p{N}])" : "(?![\\p{L}\\p{M}\\p{N}])";
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
