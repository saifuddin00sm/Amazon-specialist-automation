import { Inngest, eventType } from "inngest";
import { z } from "zod";

/** The app's Inngest client. The web app serves its functions at /api/inngest. */
export const inngest = new Inngest({ id: "specialist" });

/** Sync one seller account's catalog from Amazon now: sent nightly for every authorized account, and on demand. */
export const catalogSyncRequested = eventType("amazon/catalog.sync.requested", {
  schema: z.object({ sellerAccountId: z.string().min(1) }),
});
