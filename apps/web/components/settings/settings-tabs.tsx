"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SETTINGS_TABS = [
  { href: "/settings", label: "Agents" },
  { href: "/settings/guardrails", label: "Guardrails" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/branding", label: "Branding" },
] as const;

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto border-b">
      {SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** A titled card for one group of settings. */
export function SettingsSection({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex max-w-4xl flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Explains why a form is read-only. */
export function OwnersOnlyNote({ canEdit, what = "change these settings" }: { canEdit: boolean; what?: string }) {
  if (canEdit) return null;
  return <p className="text-sm text-muted-foreground">Only workspace owners can {what}.</p>;
}
