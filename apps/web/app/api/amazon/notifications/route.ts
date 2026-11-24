import { forwardListingsNotification } from "@app/workflows";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Amazon's listing notifications (LISTINGS_ITEM_ISSUES_CHANGE, LISTINGS_ITEM_STATUS_CHANGE), delivered
 * by an EventBridge API destination with `Authorization: Bearer <AMAZON_NOTIFICATIONS_SECRET>`. Each
 * one is handed to the workflows following that listing; anything else is acknowledged and dropped.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.AMAZON_NOTIFICATIONS_SECRET;
  if (!secret) return Response.json({ error: "Notifications aren't set up." }, { status: 503 });
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return Response.json({ error: "Send the notification as JSON." }, { status: 400 });
  }
  const forwarded = await forwardListingsNotification(message);
  return Response.json({ forwarded }, { status: 202 });
}

/** Compares in constant time, so the secret can't be guessed a character at a time. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
