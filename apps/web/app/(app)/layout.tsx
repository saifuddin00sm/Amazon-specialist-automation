import { Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SellerContextProvider } from "@/components/shell/seller-context";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataSource, getSignedInUser } from "@/lib/data";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

/** With DATA_SOURCE=supabase the shell's workspaces depend on who is signed in, so it renders per request. */
async function AppShell({ children }: { children: React.ReactNode }) {
  const dataSource = await getDataSource();
  const [workspaces, sellerAccounts, user] = await Promise.all([
    dataSource.listWorkspaces(),
    dataSource.listSellerAccounts(),
    getSignedInUser(),
  ]);

  return (
    <SellerContextProvider workspaces={workspaces} sellerAccounts={sellerAccounts}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <TopBar user={user} />
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
