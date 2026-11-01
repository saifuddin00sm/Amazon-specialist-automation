import type { Metadata } from "next";
import { BrandingSection } from "@/components/settings/branding-section";

export const metadata: Metadata = { title: "Report branding" };

export default function BrandingPage() {
  return <BrandingSection />;
}
