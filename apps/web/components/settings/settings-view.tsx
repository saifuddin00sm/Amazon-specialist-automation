"use client";

import type { MemberRole } from "@app/core";
import { useSellerContext } from "@/components/shell/seller-context";
import { BrandingForm } from "./branding-form";

/** Settings of the workspace picked in the top bar. Report branding is the first section. */
export function SettingsView({ roles }: { roles: Record<string, MemberRole> }) {
  const { workspace } = useSellerContext();
  if (!workspace) return null;

  return (
    <section className="flex max-w-3xl flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="branding-heading">
      <div className="flex flex-col gap-1">
        <h2 id="branding-heading" className="text-lg font-semibold">
          Report branding
        </h2>
        <p className="text-sm text-muted-foreground">
          Weekly reports carry this name, logo and colors instead of the app&apos;s, for every account in {workspace.name}.
        </p>
      </div>
      {/* Keyed so switching workspaces starts from that workspace's saved branding. */}
      <BrandingForm key={workspace.id} workspace={workspace} canEdit={roles[workspace.id] === "owner"} />
    </section>
  );
}
