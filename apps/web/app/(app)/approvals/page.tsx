import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return <PagePlaceholder href="/approvals" />;
}
