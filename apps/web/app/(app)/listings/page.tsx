import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Listings" };

export default function ListingsPage() {
  return <PagePlaceholder href="/listings" />;
}
