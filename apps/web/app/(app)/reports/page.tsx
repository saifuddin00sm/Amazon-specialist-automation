import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReportsView } from "@/components/reports/reports-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavItem } from "@/lib/navigation";
import { loadReports } from "./load-report";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { title, description, icon: Icon } = getNavItem("/reports");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon className="size-6 text-muted-foreground" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Request time: the changes section follows approvals made today. */
async function Reports({ searchParams }: Pick<PageProps<"/reports">, "searchParams">) {
  await connection();
  const { week } = await searchParams;
  const reports = await loadReports(typeof week === "string" ? week : undefined);
  return <ReportsView reports={reports} />;
}
