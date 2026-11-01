import { connection } from "next/server";
import { Suspense } from "react";
import { AgentsPausedBanner } from "@/components/shell/agents-paused-banner";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SellerContextProvider } from "@/components/shell/seller-context";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataSource, getSignedInUser, getViewAs } from "@/lib/data";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

/**
 * Renders per request: the workspaces depend on who is signed in, and settings (the kill switch,
 * accounts, roles) change at runtime. Without connection() the mock shell would be prerendered.
 */
async function AppShell({ children }: { children: React.ReactNode }) {
  await connection();
  const dataSource = await getDataSource();
  const [workspaces, sellerAccounts, user, viewAs] = await Promise.all([
    dataSource.listWorkspaces(),
    dataSource.listSellerAccounts(),
    getSignedInUser(),
    getViewAs(),
  ]);
  const acting = await Promise.all(workspaces.map((workspace) => dataSource.getActingMember(workspace.id)));
  const members = Object.fromEntries(
    acting.flatMap((member) => (member ? [[member.workspaceId, { id: member.id, name: member.name, role: member.role }]] : [])),
  );

  return (
    <SellerContextProvider workspaces={workspaces} sellerAccounts={sellerAccounts} members={members}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <TopBar user={user} viewAs={viewAs} />
          <AgentsPausedBanner />
          <main className="flex flex-1 flex-col p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SellerContextProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r p-3 md:flex">
        <Skeleton className="h-10" />
        <Skeleton className="mt-4 h-6" />
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="flex flex-col gap-4 p-4 md:p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96" />
        </div>
      </div>
    </div>
  );
}
