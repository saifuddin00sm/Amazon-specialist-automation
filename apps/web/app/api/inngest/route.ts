import { functions, inngest } from "@app/workflows";
import { serve } from "inngest/next";

/** Inngest calls this to run the app's durable workflows (packages/workflows). It signs its requests. */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
