"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { isNavItemActive, mainNav, settingsNav, type NavItem } from "@/lib/navigation";
import { siteConfig } from "@/lib/site";

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
      <Link href={item.href}>
        <item.icon />
        <span>{item.title}</span>
      </Link>
    </SidebarMenuButton>
  );
}

function ActiveNavButton({ item }: { item: NavItem }) {
  const pathname = usePathname();
  return <NavButton item={item} active={isNavItemActive(pathname, item.href)} />;
}

/**
 * On dynamic routes (e.g. /listings/[productId]) the pathname isn't known when the shell is
 * prerendered, so the active highlight streams in behind Suspense while the link itself stays static.
 */
function NavLink({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <Suspense fallback={<NavButton item={item} active={false} />}>
        <ActiveNavButton item={item} />
      </Suspense>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Bot className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{siteConfig.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {siteConfig.description}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <NavLink item={settingsNav} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
