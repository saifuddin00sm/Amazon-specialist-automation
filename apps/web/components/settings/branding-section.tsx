"use client";

import { useSellerContext } from "@/components/shell/seller-context";
import { BrandingForm } from "./branding-form";
import { SettingsSection } from "./settings-tabs";

/** Report branding for the workspace picked in the top bar. */
export function BrandingSection() {
  const { workspace, member } = useSellerContext();
  if (!workspace) return null;

  return (
    <SettingsSection
      title="Report branding"
      description={`Weekly reports carry this name, logo and colors instead of the app's, for every account in ${workspace.name}.`}
    >
      {/* Keyed so switching workspaces starts from that workspace's saved branding. */}
      <BrandingForm key={workspace.id} workspace={workspace} canEdit={member?.role === "owner"} />
    </SettingsSection>
  );
}
