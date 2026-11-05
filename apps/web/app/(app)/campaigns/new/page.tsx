import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewCampaignWizard } from "@/components/campaigns/new-campaign-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCatalog } from "./load-catalog";

export const metadata: Metadata = { title: "New campaign" };

export default function NewCampaignPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <Link href="/campaigns" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Campaigns
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-sm text-muted-foreground">
          Pick products and a goal. The campaign strategist drafts the campaigns as one plan for approval; nothing is created on
          Amazon until it&apos;s approved.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Wizard />
      </Suspense>
    </div>
  );
}

/** Request time: the catalog and guardrails can change between visits. */
async function Wizard() {
  await connection();
  const catalog = await loadCatalog();
  return <NewCampaignWizard catalog={catalog} />;
}
