import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CampaignTable } from "@/components/campaigns/campaign-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavItem } from "@/lib/navigation";
import { loadCampaigns } from "./load-campaigns";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  const { title, description, icon: Icon } = getNavItem("/campaigns");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Icon className="size-6 text-muted-foreground" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus />
            New campaign
          </Link>
        </Button>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Campaigns />
      </Suspense>
    </div>
  );
}

/** Request time: plans filed from the campaign page show up here right away. */
async function Campaigns() {
  await connection();
  const data = await loadCampaigns();
  return <CampaignTable data={data} />;
}
