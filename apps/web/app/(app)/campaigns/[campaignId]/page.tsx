import { canActOnAccount, type AdMetricsDaily, type Target } from "@app/core";
import { AGENTS_PAUSED_MESSAGE } from "@app/data";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { AcosValue } from "@/components/campaigns/acos-value";
import { BreakevenCalculator } from "@/components/campaigns/breakeven-calculator";
import { CampaignOptimizerPanel } from "@/components/campaigns/campaign-optimizer-panel";
import { PlanTree, type PlanOverlay, type PlanTreeGroup } from "@/components/campaigns/plan-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CAMPAIGN_DAYS, campaignWindows, groupPlanLines, planLabels, summarizeAds } from "@/lib/campaigns";
import { getDataSource } from "@/lib/data";
import { CAMPAIGN_TYPE_LABELS, formatDay, formatMoney, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Campaign" };

export default function CampaignPage({ params }: PageProps<"/campaigns/[campaignId]">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <Link href="/campaigns" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Campaigns
      </Link>
      <Suspense fallback={<CampaignSkeleton />}>
        <CampaignView params={params} />
      </Suspense>
    </div>
  );
}

/** Request time: runs and plans change while you watch. */
async function CampaignView({ params }: { params: PageProps<"/campaigns/[campaignId]">["params"] }) {
  await connection();
  const { campaignId } = await params;
  const dataSource = await getDataSource();
  const campaign = await dataSource.getCampaign(campaignId);
  const account = campaign && (await dataSource.getSellerAccount(campaign.sellerAccountId));
  if (!campaign || !account) notFound();

  const [adGroups, available, products, runs, pending, member, workspace] = await Promise.all([
    dataSource.listAdGroups(campaign.id),
    dataSource.getMetricsDateRange(account.id),
    dataSource.listProducts({ sellerAccountId: account.id }),
    dataSource.listAgentRuns({ workspaceId: account.workspaceId, subjectId: campaign.id, limit: 1 }),
    dataSource.listProposals({ workspaceId: account.workspaceId, status: "pending_approval", type: "campaign_plan" }),
    dataSource.getActingMember(account.workspaceId),
    dataSource.getWorkspace(account.workspaceId),
  ]);
  const targetsByGroup = await Promise.all(adGroups.map((adGroup) => dataSource.listTargets(adGroup.id)));
  const targets: Target[] = targetsByGroup.flat();
  const window = campaignWindows(available)?.current;
  const rows: AdMetricsDaily[] =
    window && targets.length > 0
      ? await dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "target", entityIds: targets.map((target) => target.id), range: window })
      : [];

  const rowsFor = new Map<string, AdMetricsDaily[]>();
  for (const row of rows) rowsFor.set(row.entityId, [...(rowsFor.get(row.entityId) ?? []), row]);
  const range = window ?? { from: "", to: "" };
  const groups: PlanTreeGroup[] = adGroups.map((adGroup, i) => {
    const own = targetsByGroup[i] ?? [];
    return {
      adGroup,
      summary: summarizeAds(own.flatMap((target) => rowsFor.get(target.id) ?? []), range),
      targets: own.map((target) => ({ target, summary: summarizeAds(rowsFor.get(target.id) ?? [], range) })),
    };
  });
  const totals = summarizeAds(rows, range);

  const plan = pending.find((proposal) => proposal.target.id === campaign.id);
  const overlay: PlanOverlay | undefined = plan && {
    createdBy: plan.createdBy,
    groups: groupPlanLines(plan.diff, planLabels(adGroups, targets)).groups,
  };
  const counts = overlay?.groups.reduce(
    (sum, group) => ({
      lowered: sum.lowered + group.bids.filter((bid) => bid.after < bid.before).length,
      raised: sum.raised + group.bids.filter((bid) => bid.after > bid.before).length,
      keywords: sum.keywords + group.keywords.length,
      negatives: sum.negatives + group.negatives.length,
    }),
    { lowered: 0, raised: 0, keywords: 0, negatives: 0 },
  );

  const advertised = new Set(adGroups.flatMap((adGroup) => adGroup.productIds));
  const prices = products.filter((product) => advertised.has(product.id)).map((product) => product.price);
  const averagePrice = prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
  const canRun = Boolean(member && canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id }));
  const money = (amount: number) => formatMoney(amount, account.currency);

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{CAMPAIGN_TYPE_LABELS[campaign.type]}</Badge>
          <Badge variant="outline" className="capitalize">
            {campaign.targetingType} targeting
          </Badge>
          <Badge variant={campaign.state === "enabled" ? "outline" : "destructive"} className="capitalize">
            {campaign.state}
          </Badge>
          <Badge variant="outline">{account.name}</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Stat label="Daily budget">{money(campaign.dailyBudget)}</Stat>
          <Stat label={`Spend, ${CAMPAIGN_DAYS} days`}>{money(totals.spend)}</Stat>
          <Stat label="Ad sales">{money(totals.sales)}</Stat>
          <Stat label={`ACoS · target ${formatPercent(account.targetAcos, 0)}`}>
            <AcosValue acos={totals.acos} target={account.targetAcos} />
          </Stat>
          <Stat label="Orders">{totals.orders}</Stat>
          <Stat label="Conversion">{totals.clicks > 0 ? formatPercent(totals.orders / totals.clicks) : "–"}</Stat>
        </dl>
        {window && (
          <p className="text-xs text-muted-foreground">
            {formatDay(window.from)} – {formatDay(window.to)}
          </p>
        )}
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="optimizer-heading">
        <h2 id="optimizer-heading" className="text-lg font-semibold">
          Campaign optimizer
        </h2>
        <CampaignOptimizerPanel
          campaignId={campaign.id}
          latestRun={runs[0]}
          pendingPlanId={plan?.id}
          blockedReason={
            workspace?.agentsPausedAt
              ? AGENTS_PAUSED_MESSAGE
              : !canRun
              ? "You can't run agents on this account."
              : campaign.state !== "enabled"
                ? "Only enabled campaigns can be optimized."
                : !window
                  ? "This campaign has no ad metrics to work from yet."
                  : undefined
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="plan-heading">
          <h2 id="plan-heading" className="text-lg font-semibold">
            Plan
          </h2>
          {plan && counts && (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-sm"
              data-testid="plan-suggestions"
            >
              <span className="font-medium">Optimizer suggestions</span>
              <AIGeneratedBadge actor={plan.createdBy} />
              <span className="text-muted-foreground tabular-nums">
                {[
                  counts.lowered > 0 && `${counts.lowered} lower bids`,
                  counts.raised > 0 && `${counts.raised} higher bids`,
                  counts.keywords > 0 && `${counts.keywords} new keywords`,
                  counts.negatives > 0 && `${counts.negatives} negatives`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <Button asChild size="sm" variant="outline" className="ml-auto">
                <Link href={`/approvals?proposal=${plan.id}`}>Review in Approvals</Link>
              </Button>
            </div>
          )}
          <PlanTree campaign={campaign} groups={groups} currency={account.currency} targetAcos={account.targetAcos} plan={overlay} />
        </section>

        <BreakevenCalculator
          currency={account.currency}
          averagePrice={totals.orders > 0 ? totals.sales / totals.orders : averagePrice}
          targetAcos={account.targetAcos}
          campaignAcos={totals.acos}
          averageCpc={totals.clicks > 0 ? totals.spend / totals.clicks : undefined}
          conversionRate={totals.clicks > 0 ? totals.orders / totals.clicks : undefined}
        />
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function CampaignSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading campaign">
      <Skeleton className="h-24 w-2/3" />
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
