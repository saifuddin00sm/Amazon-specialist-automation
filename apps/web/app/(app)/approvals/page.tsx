import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ApprovalsWorkbench } from "@/components/approvals/approvals-workbench";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavItem } from "@/lib/navigation";
import { loadApprovals } from "./load-approvals";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  const { title, description, icon: Icon } = getNavItem("/approvals");

  return (
    <div className="flex flex-1 flex-col gap-4 lg:h-[calc(100svh-3.5rem-3rem)] lg:flex-none">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon className="size-6 text-muted-foreground" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Suspense fallback={<ApprovalsSkeleton />}>
        <ApprovalsQueue />
      </Suspense>
    </div>
  );
}

/** Reads at request time: the queue changes with every decision. */
async function ApprovalsQueue() {
  await connection();
  const data = await loadApprovals();
  return <ApprovalsWorkbench data={data} />;
}

function ApprovalsSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy="true" aria-label="Loading proposals">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <Skeleton className="h-96 lg:h-full" />
        <Skeleton className="h-96 lg:h-full" />
      </div>
    </div>
  );
}
