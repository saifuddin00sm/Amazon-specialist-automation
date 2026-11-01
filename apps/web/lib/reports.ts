import {
  DEFAULT_BRANDING,
  parseCampaignPlanLine,
  type Actor,
  type AdMetricsDaily,
  type Branding,
  type Campaign,
  type Currency,
  type Member,
  type Product,
  type ProductMetricsDaily,
  type Proposal,
  type ProposalType,
  type SellerAccount,
  type Workspace,
} from "@app/core";
import type { DateRange } from "@app/data";
import { fieldLabel, formatMoney } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A report covers one week. */
export const REPORT_DAYS = 7;
/** Rows in the campaign and product tables. */
const TOP_ROWS = 5;
/** Changes smaller than this read as "about the same". */
const FLAT_CHANGE = 0.02;

/** How the summary counts applied changes, singular and plural. */
const CHANGE_NOUNS: Record<ProposalType, [string, string]> = {
  listing_update: ["listing rewrite", "listing rewrites"],
  price_change: ["price change", "price changes"],
  bid_change: ["bid change", "bid changes"],
  budget_change: ["budget change", "budget changes"],
  keyword_add: ["new keyword", "new keywords"],
  keyword_negate: ["negative keyword", "negative keywords"],
  target_pause: ["paused target", "paused targets"],
  campaign_plan: ["campaign plan", "campaign plans"],
};

/** Full weeks with metrics, newest first, ending on the newest day the account has. */
export function reportWeeks(available: DateRange | undefined, count = 8): DateRange[] {
  if (!available) return [];
  const weeks: DateRange[] = [];
  for (let end = Date.parse(`${available.to}T00:00:00.000Z`); weeks.length < count; end -= REPORT_DAYS * DAY_MS) {
    const from = isoDate(end - (REPORT_DAYS - 1) * DAY_MS);
    if (from < available.from) break;
    weeks.push({ from, to: isoDate(end) });
  }
  return weeks;
}

/** The week before `week`. */
export function weekBefore(week: DateRange): DateRange {
  const shift = (date: string) => isoDate(Date.parse(`${date}T00:00:00.000Z`) - REPORT_DAYS * DAY_MS);
  return { from: shift(week.from), to: shift(week.to) };
}

/** A number this week, and the week before when there is one. */
export type Comparison = { current: number; previous?: number };

export type ReportChange = {
  proposalId: string;
  type: ProposalType;
  title: string;
  /** The change in numbers, e.g. "Bid $1.20 → $0.95". */
  detail?: string;
  appliedAt: string;
  /** Who approved it: a member's name, or that it was auto-approved within guardrails. */
  approvedBy: string;
  createdBy: Actor;
};

export type WeeklyReport = {
  account: Pick<SellerAccount, "id" | "name" | "marketplace" | "currency" | "targetAcos">;
  workspaceName: string;
  /** The workspace's branding, or the default; `displayName` is always set. */
  branding: Branding & { displayName: string };
  week: DateRange;
  /** Undefined when the account has no metrics for the week before. */
  previous?: DateRange;
  kpis: {
    sales: Comparison;
    units: Comparison;
    adSpend: Comparison;
    adSales: Comparison;
    /** Fractions; undefined without sales. */
    acos: { current?: number; previous?: number };
    tacos: { current?: number; previous?: number };
  };
  /** Every day of the week, oldest first, with the same weekday of the week before. */
  daily: { date: string; sales: number; previousSales?: number; adSales: number; spend: number }[];
  campaigns: { id: string; name: string; spend: number; sales: number; acos?: number }[];
  products: { id: string; title: string; units: number; revenue: number; previousRevenue?: number }[];
  /** Proposals applied during the week, oldest first. */
  changes: ReportChange[];
  /** Decisions recorded during the week, and what is waiting now. */
  decisions: { approved: number; rejected: number; waiting: number };
  /** Plain-language paragraphs. */
  summary: string[];
  generatedAt: string;
};

export type ReportInput = {
  account: SellerAccount;
  workspace: Workspace;
  week: DateRange;
  previous?: DateRange;
  /** Product and campaign rows covering both weeks. */
  productRows: readonly ProductMetricsDaily[];
  campaignRows: readonly AdMetricsDaily[];
  products: readonly Product[];
  campaigns: readonly Campaign[];
  /** The account's proposals, any status. */
  proposals: readonly Proposal[];
  members: readonly Member[];
  generatedAt: string;
};

export function buildWeeklyReport(input: ReportInput): WeeklyReport {
  const { account, workspace, week, previous } = input;
  const inWeek = (date: string, range: DateRange | undefined) => range !== undefined && date >= range.from && date <= range.to;
  const sum = <T>(rows: readonly T[], value: (row: T) => number) => cents(rows.reduce((total, row) => total + value(row), 0));

  const products = { now: input.productRows.filter((row) => inWeek(row.date, week)), before: input.productRows.filter((row) => inWeek(row.date, previous)) };
  const ads = { now: input.campaignRows.filter((row) => inWeek(row.date, week)), before: input.campaignRows.filter((row) => inWeek(row.date, previous)) };
  const compare = <T>(rows: { now: readonly T[]; before: readonly T[] }, value: (row: T) => number): Comparison => ({
    current: sum(rows.now, value),
    ...(previous ? { previous: sum(rows.before, value) } : {}),
  });

  const sales = compare(products, (row) => row.orderedRevenue);
  const units = compare(products, (row) => row.unitsOrdered);
  const adSpend = compare(ads, (row) => row.spend);
  const adSales = compare(ads, (row) => row.adSales);
  const ratio = (top: number | undefined, bottom: number | undefined) => (top !== undefined && bottom ? top / bottom : undefined);

  const days = Array.from({ length: REPORT_DAYS }, (_, i) => isoDate(Date.parse(`${week.from}T00:00:00.000Z`) + i * DAY_MS));
  const daily = days.map((date, i) => {
    const before = previous ? isoDate(Date.parse(`${previous.from}T00:00:00.000Z`) + i * DAY_MS) : undefined;
    const onDay = <T extends { date: string }>(rows: readonly T[], day: string | undefined) => rows.filter((row) => row.date === day);
    return {
      date,
      sales: sum(onDay(products.now, date), (row) => row.orderedRevenue),
      ...(before ? { previousSales: sum(onDay(products.before, before), (row) => row.orderedRevenue) } : {}),
      adSales: sum(onDay(ads.now, date), (row) => row.adSales),
      spend: sum(onDay(ads.now, date), (row) => row.spend),
    };
  });

  const campaigns = input.campaigns
    .map((campaign) => {
      const own = ads.now.filter((row) => row.entityId === campaign.id);
      const spend = sum(own, (row) => row.spend);
      const campaignSales = sum(own, (row) => row.adSales);
      return { id: campaign.id, name: campaign.name, spend, sales: campaignSales, ...(campaignSales > 0 ? { acos: spend / campaignSales } : {}) };
    })
    .filter((campaign) => campaign.spend > 0 || campaign.sales > 0)
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
    .slice(0, TOP_ROWS);

  const topProducts = input.products
    .map((product) => {
      const own = products.now.filter((row) => row.entityId === product.id);
      return {
        id: product.id,
        title: product.title,
        units: sum(own, (row) => row.unitsOrdered),
        revenue: sum(own, (row) => row.orderedRevenue),
        ...(previous ? { previousRevenue: sum(products.before.filter((row) => row.entityId === product.id), (row) => row.orderedRevenue) } : {}),
      };
    })
    .filter((product) => product.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || a.title.localeCompare(b.title))
    .slice(0, TOP_ROWS);

  const memberName = new Map(input.members.map((member) => [member.id, member.name]));
  const approvedBy = (actor: Actor | undefined) =>
    actor?.type === "member" ? (memberName.get(actor.memberId) ?? "A team member") : "Auto-approved within guardrails";
  const changes = input.proposals
    .filter((proposal) => proposal.status === "applied" && proposal.appliedAt !== undefined && inWeek(proposal.appliedAt.slice(0, 10), week))
    .sort((a, b) => a.appliedAt!.localeCompare(b.appliedAt!) || a.id.localeCompare(b.id))
    .map(
      (proposal): ReportChange => ({
        proposalId: proposal.id,
        type: proposal.type,
        title: proposal.title,
        ...(changeDetail(proposal, account.currency) ? { detail: changeDetail(proposal, account.currency) } : {}),
        appliedAt: proposal.appliedAt!,
        approvedBy: approvedBy(proposal.decidedBy),
        createdBy: proposal.createdBy,
      }),
    );
  const decidedInWeek = input.proposals.filter((proposal) => proposal.decidedAt !== undefined && inWeek(proposal.decidedAt.slice(0, 10), week));
  const decisions = {
    approved: decidedInWeek.filter((proposal) => ["approved", "applied", "failed"].includes(proposal.status)).length,
    rejected: decidedInWeek.filter((proposal) => proposal.status === "rejected").length,
    waiting: input.proposals.filter((proposal) => proposal.status === "pending_approval").length,
  };

  const report: Omit<WeeklyReport, "summary"> = {
    account: { id: account.id, name: account.name, marketplace: account.marketplace, currency: account.currency, targetAcos: account.targetAcos },
    workspaceName: workspace.name,
    branding: { ...(workspace.branding ?? DEFAULT_BRANDING), displayName: workspace.branding?.displayName ?? workspace.name },
    week,
    ...(previous ? { previous } : {}),
    kpis: {
      sales,
      units,
      adSpend,
      adSales,
      acos: { current: ratio(adSpend.current, adSales.current), previous: ratio(adSpend.previous, adSales.previous) },
      tacos: { current: ratio(adSpend.current, sales.current), previous: ratio(adSpend.previous, sales.previous) },
    },
    daily,
    campaigns,
    products: topProducts,
    changes,
    decisions,
    generatedAt: input.generatedAt,
  };
  return { ...report, summary: reportSummary(report) };
}

/** The report in a few plain sentences, from its own numbers. */
export function reportSummary(report: Omit<WeeklyReport, "summary">): string[] {
  const money = (amount: number) => formatMoney(amount, report.account.currency);
  const { sales, units, adSpend, adSales, acos, tacos } = report.kpis;
  const paragraphs: string[] = [];

  paragraphs.push(
    `Sales were ${money(sales.current)} this week${trend(sales)}, on ${units.current.toLocaleString("en-US")} ${units.current === 1 ? "unit" : "units"}.` +
      (report.products[0] ? ` The best seller was ${report.products[0].title} at ${money(report.products[0].revenue)}.` : ""),
  );

  if (adSpend.current === 0) {
    paragraphs.push("There was no ad spend this week.");
  } else if (acos.current === undefined) {
    paragraphs.push(`Ads cost ${money(adSpend.current)} without any attributed sales.`);
  } else {
    const target = report.account.targetAcos;
    const position = acos.current > target * 1.1 ? "above" : acos.current < target * 0.9 ? "under" : "on";
    paragraphs.push(
      `Ads cost ${money(adSpend.current)} and brought in ${money(adSales.current)} in sales, an ACoS of ${whole(acos.current)}, ` +
        `${position} the ${whole(target)} target.` +
        (tacos.current !== undefined
          ? ` Advertising was ${tenths(tacos.current)} of all sales${tacos.previous !== undefined ? `, against ${tenths(tacos.previous)} the week before` : ""}.`
          : ""),
    );
  }

  const byType = new Map<ProposalType, number>();
  for (const change of report.changes) byType.set(change.type, (byType.get(change.type) ?? 0) + 1);
  const kinds = [...byType].map(([type, count]) => `${count} ${CHANGE_NOUNS[type][count === 1 ? 0 : 1]}`);
  const waiting = report.decisions.waiting;
  paragraphs.push(
    (report.changes.length === 0
      ? "No changes went live this week."
      : `${report.changes.length} ${report.changes.length === 1 ? "change" : "changes"} went live (${kinds.join(", ")}), each approved before it was applied.`) +
      (waiting > 0 ? ` ${waiting} ${waiting === 1 ? "proposal is" : "proposals are"} waiting for approval.` : ""),
  );
  return paragraphs;
}

/** Fractional change; undefined when there was nothing before. */
export function change({ current, previous }: Comparison): number | undefined {
  return previous !== undefined && previous > 0 ? (current - previous) / previous : undefined;
}

/** What a proposal changed, in a few words. */
export function changeDetail(proposal: Proposal, currency: Currency): string | undefined {
  const money = (value: unknown) => (typeof value === "number" ? formatMoney(value, currency) : String(value));
  const [first] = proposal.diff;
  switch (proposal.type) {
    case "bid_change":
    case "budget_change":
    case "price_change":
      return first ? `${fieldLabel(first.path)} ${money(first.before)} → ${money(first.after)}` : undefined;
    case "listing_update":
      return `Updated ${proposal.diff.map((entry) => fieldLabel(entry.path).toLowerCase()).join(", ")}`;
    case "keyword_add": {
      const value = first?.after;
      return value && typeof value === "object" && !Array.isArray(value)
        ? `"${String(value.keyword)}" (${String(value.matchType)}) at ${money(value.bid)}`
        : undefined;
    }
    case "keyword_negate": {
      const before = new Set(Array.isArray(first?.before) ? first.before : []);
      const added = Array.isArray(first?.after) ? first.after.filter((term) => !before.has(term)) : [];
      return added.length > 0 ? `Negated ${added.map((term) => `"${String(term)}"`).join(", ")}` : undefined;
    }
    case "target_pause":
      return "Paused";
    case "campaign_plan": {
      const lines = proposal.diff.map(parseCampaignPlanLine);
      const count = (kind: string) => lines.filter((line) => line?.kind === kind).length;
      return [
        count("bid") && `${count("bid")} bid changes`,
        count("keyword") && `${count("keyword")} new keywords`,
        count("negative") && `${count("negative")} negatives`,
      ]
        .filter(Boolean)
        .join(", ");
    }
  }
}

function trend(comparison: Comparison): string {
  const fraction = change(comparison);
  if (fraction === undefined) return "";
  if (Math.abs(fraction) < FLAT_CHANGE) return ", about the same as the week before";
  return `, ${fraction > 0 ? "up" : "down"} ${whole(Math.abs(fraction))} from the week before`;
}

function whole(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** TACoS is often a few percent, where whole numbers would hide the change. */
function tenths(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
