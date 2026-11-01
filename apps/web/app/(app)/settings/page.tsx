import type { MemberRole } from "@app/core";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataSource } from "@/lib/data";
import { getNavItem } from "@/lib/navigation";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  const { title, description, icon: Icon } = getNavItem("/settings");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon className="size-6 text-muted-foreground" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 max-w-3xl" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

/** The acting member's role per workspace decides who may edit. Workspaces come from the shell. */
async function Settings() {
  await connection();
  const dataSource = await getDataSource();
  const workspaces = await dataSource.listWorkspaces();
  const members = await Promise.all(workspaces.map((workspace) => dataSource.getActingMember(workspace.id)));
  const roles: Record<string, MemberRole> = Object.fromEntries(
    members.flatMap((member, i) => (member ? [[workspaces[i]!.id, member.role]] : [])),
  );
  return <SettingsView roles={roles} />;
}
