import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getNavItem } from "@/lib/navigation";

export function PagePlaceholder({ href }: { href: string }) {
  const { title, description, icon: Icon } = getNavItem(href);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon className="size-6 text-muted-foreground" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Card className="flex-1 border-dashed shadow-none">
        <CardContent className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center">
          <Construction className="size-8 text-muted-foreground" />
          <p className="font-medium">{title} is coming soon</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This section is a placeholder in the app shell.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
