import { getDataSource } from "@app/data";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SellerContextProvider } from "@/components/shell/seller-context";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const dataSource = getDataSource();
  const [workspaces, sellerAccounts] = await Promise.all([
    dataSource.listWorkspaces(),
    dataSource.listSellerAccounts(),
  ]);

  return (
    <SellerContextProvider workspaces={workspaces} sellerAccounts={sellerAccounts}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <TopBar />
          <main className="flex flex-1 flex-col p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SellerContextProvider>
  );
}
