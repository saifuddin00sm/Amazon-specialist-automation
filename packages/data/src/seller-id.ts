/**
 * A made-up Amazon merchant token ("A" and 13 uppercase letters or digits) for an account connected
 * through the Phase 1 mock of Amazon's authorization. The real one comes back from Amazon.
 */
export function randomSellerId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(13));
  return `A${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
}
