import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return <PagePlaceholder href="/campaigns" />;
}
