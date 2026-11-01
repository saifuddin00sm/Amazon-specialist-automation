import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { TeamView } from "@/components/settings/team-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataSource } from "@/lib/data";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 max-w-4xl" />}>
      <Team />
    </Suspense>
  );
}

/** Members of every workspace you can see; the view shows the one picked in the top bar. */
async function Team() {
  await connection();
  const dataSource = await getDataSource();
  const workspaces = await dataSource.listWorkspaces();
  const members = await Promise.all(workspaces.map((workspace) => dataSource.listMembers(workspace.id)));
  return <TeamView members={Object.fromEntries(workspaces.map((workspace, i) => [workspace.id, members[i]!]))} />;
}
