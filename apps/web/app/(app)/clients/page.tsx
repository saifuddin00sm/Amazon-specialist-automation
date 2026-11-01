import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClientList } from "@/components/clients/client-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavItem } from "@/lib/navigation";
import { loadClients } from "./load-clients";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  const { title, description, icon: Icon } = getNavItem("/clients");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon className="size-6 text-muted-foreground" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Clients />
      </Suspense>
    </div>
  );
}

/** Request time: health follows decisions made today. */
async function Clients() {
  await connection();
  return <ClientList rows={await loadClients()} />;
}
