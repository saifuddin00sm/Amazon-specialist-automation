import {
  ChartColumn,
  ClipboardCheck,
  LayoutDashboard,
  Megaphone,
  Package,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

export const mainNav: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Account health, agent activity, and what needs your attention.",
  },
  {
    title: "Approvals",
    href: "/approvals",
    icon: ClipboardCheck,
    description: "Proposals waiting for a human decision before anything changes on Amazon.",
  },
  {
    title: "Listings",
    href: "/listings",
    icon: Package,
    description: "Product listings, their versions, and review scores.",
  },
  {
    title: "Campaigns",
    href: "/campaigns",
    icon: Megaphone,
    description: "Advertising campaigns, budgets, and bid changes.",
  },
  {
    title: "Reports",
    href: "/reports",
    icon: ChartColumn,
    description: "Weekly reports with your branding, ready to print or save as PDF.",
  },
];

export const settingsNav: NavItem = {
  title: "Settings",
  href: "/settings",
  icon: Settings,
  description: "Workspace, seller accounts, autonomy levels, and guardrails.",
};

export const allNav: NavItem[] = [...mainNav, settingsNav];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getNavItem(href: string): NavItem {
  const item = allNav.find((navItem) => navItem.href === href);
  if (!item) throw new Error(`Unknown nav item: ${href}`);
  return item;
}
