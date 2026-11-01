import { SettingsTabs } from "@/components/settings/settings-tabs";
import { getNavItem } from "@/lib/navigation";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
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
      <SettingsTabs />
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
