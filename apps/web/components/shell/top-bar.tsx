import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { SignedInUser } from "@/lib/data";
import { SellerAccountSwitcher } from "./seller-account-switcher";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function TopBar({ user }: { user?: SignedInUser }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 items-center gap-1">
        <WorkspaceSwitcher />
        <span className="text-muted-foreground" aria-hidden>
          /
        </span>
        <SellerAccountSwitcher />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        {user && <UserMenu user={user} />}
      </div>
    </header>
  );
}
