import {
  checkProposalCompliance,
  guardrailsFor,
  type AdMetricsDaily,
  type AuditEvent,
  type ListingVersion,
  type MetricsDaily,
  type Proposal,
} from "@app/core";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { AgentRunError, type DataSource, type LiveListingReview } from "../data-source";
import { completeListingOptimizerRun, startListingOptimizerRun, type RunStore } from "../agents/agent-runs";
import { campaignOptimizerWindow } from "../agents/campaign-optimizer";
import { completeCampaignOptimizerRun, startCampaignOptimizerRun, type CampaignRunStore } from "../agents/campaign-runs";
import { completeCampaignStrategistRun, startCampaignStrategistRun, type StrategistStore } from "../agents/campaign-strategist";
import {
  ProposalWriteError,
  approveProposalWrite,
  rejectProposalWrite,
  snoozeProposalWrite,
  type AuditEventDraft,
  type ProposalWriteContext,
  type ProposalWriteResult,
} from "../proposal-writes";
import {
  SettingsWriteError,
  accountSettingsWrite,
  agentsPausedWrite,
  brandingWrite,
  connectAccountWrite,
  inviteMemberWrite,
  removeMemberWrite,
  updateMemberWrite,
} from "../settings-writes";
import { randomSellerId } from "../seller-id";
import type { Database, Json } from "./database.types";
import {
  adGroupFromRow,
  agentRunFromRow,
  agentRunToRow,
  auditEventFromRow,
  auditEventToRow,
  campaignFromRow,
  listingVersionFromRow,
  listingVersionToRow,
  memberFromRow,
  memberToRow,
  metricsDailyFromRow,
  productFactsFromRow,
  productFromRow,
  proposalFromRow,
  proposalToRow,
  reviewFromRow,
  reviewToRow,
  sellerAccountFromRow,
  sellerAccountToRow,
  targetFromRow,
  workspaceFromRow,
} from "./rows";

export type AppSupabaseClient = SupabaseClient<Database>;

export type SupabaseDataSourceOptions = {
  /**
   * The signed-in auth user. They act as their own member and may only write as that member; row-level
   * security limits what they see. Leave it out for trusted server work with the secret key (seeding,
   * tests, background agents): the workspace owner acts, and writes may name any member.
   */
  userId?: string;
  /** Clock for writes and for deciding what is still snoozed. Defaults to the real time. */
  now?: () => Date;
};

/** A query the database refused for a reason other than the domain rules. */
export class SupabaseDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseDataError";
  }
}

/** PostgREST returns at most this many rows per request (config.toml `max_rows`); lists page through. */
const PAGE_SIZE = 1000;
const UNIQUE_VIOLATION = "23505";

type Result<T> = { data: T; error: PostgrestError | null };

function must<T>({ data, error }: Result<T>): T {
  if (error) throw new SupabaseDataError(error.code, error.message);
  return data;
}

/** Reads every row of a query, a page at a time, up to `limit`. The query must have a stable order. */
async function selectAll<T>(page: (from: number, to: number) => PromiseLike<Result<T[] | null>>, limit = Infinity): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < limit) {
    const from = rows.length;
    const size = Math.min(PAGE_SIZE, limit - from);
    const batch = must(await page(from, from + size - 1)) ?? [];
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return rows;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

/** Supabase-backed DataSource. Pass a client signed in as the user, or one with the secret key. */
export function createSupabaseDataSource(
  client: AppSupabaseClient,
  { userId, now = () => new Date() }: SupabaseDataSourceOptions = {},
): DataSource {
  const db = client;

  const getProposal = async (id: string) => {
    const row = must(await db.from("proposals").select().eq("id", id).maybeSingle());
    return row ? proposalFromRow(row) : undefined;
  };
  const getReview = async (id: string) => {
    const row = must(await db.from("reviews").select().eq("id", id).maybeSingle());
    return row ? reviewFromRow(row) : undefined;
  };
  const getProduct = async (id: string) => {
    const row = must(await db.from("products").select().eq("id", id).maybeSingle());
    return row ? productFromRow(row) : undefined;
  };
  const getProductFacts = async (productId: string) => {
    const row = must(await db.from("product_facts").select().eq("product_id", productId).maybeSingle());
    return row ? productFactsFromRow(row) : undefined;
  };
  const listListingVersions = async (productId: string) =>
    (
      await selectAll((from, to) =>
        db.from("listing_versions").select().eq("product_id", productId).order("version", { ascending: false }).range(from, to),
      )
    ).map(listingVersionFromRow);
  const getAgentRun = async (id: string) => {
    const row = must(await db.from("agent_runs").select().eq("id", id).maybeSingle());
    return row ? agentRunFromRow(row) : undefined;
  };

  /** The member writing, if this caller may write as them. */
  const writingMember = async (memberId: string) => {
    const row = must(await db.from("members").select().eq("id", memberId).maybeSingle());
    if (!row || (userId !== undefined && row.user_id !== userId)) return undefined;
    return memberFromRow(row);
  };

  const getSellerAccount = async (id: string) => {
    const row = must(await db.from("seller_accounts").select().eq("id", id).maybeSingle());
    return row ? sellerAccountFromRow(row) : undefined;
  };
  const getWorkspace = async (id: string) => {
    const row = must(await db.from("workspaces").select().eq("id", id).maybeSingle());
    return row ? workspaceFromRow(row) : undefined;
  };
  const listMembers = async (workspaceId: string) =>
    (await selectAll((from, to) => db.from("members").select().eq("workspace_id", workspaceId).order("id").range(from, to))).map(memberFromRow);
  /** What a team write needs: the workspace, the member writing, everyone in it and its accounts. */
  const teamContext = async (workspaceId: string, memberId: string) => {
    const [workspace, member, members, accounts] = await Promise.all([
      getWorkspace(workspaceId),
      writingMember(memberId),
      listMembers(workspaceId),
      selectAll((from, to) => db.from("seller_accounts").select("id").eq("workspace_id", workspaceId).order("id").range(from, to)),
    ]);
    return { workspace, member, members, accountIds: accounts.map((account) => account.id), at: now().toISOString() };
  };
  /** A settings RPC that returned false wrote nothing: RLS hid the row from this caller. */
  const settingsSaved = (saved: boolean | null, message: string) => {
    if (!saved) throw new SettingsWriteError("forbidden", message);
  };

  const withIds = (events: AuditEventDraft[]) =>
    events.map((event) => auditEventToRow({ id: newId("aud"), ...event } satisfies AuditEvent));

  const writeContext = async (proposalId: string, memberId: string): Promise<ProposalWriteContext> => {
    const [proposal, member] = await Promise.all([getProposal(proposalId), writingMember(memberId)]);
    const productId = proposal?.target.type === "product" ? proposal.target.id : undefined;
    const [versions, facts, account] = await Promise.all([
      productId ? listListingVersions(productId) : [],
      productId ? getProductFacts(productId) : undefined,
      proposal ? getSellerAccount(proposal.sellerAccountId) : undefined,
    ]);
    const liveListing = versions.find((version) => version.status === "live");
    return {
      proposal,
      member,
      at: now().toISOString(),
      checkCompliance: (diff) =>
        checkProposalCompliance({ type: proposal?.type ?? "listing_update", diff, liveListing, facts, guardrails: guardrailsFor(account ?? {}) }),
    };
  };

  const commit = async ({ proposal, events }: ProposalWriteResult, retireListingVersionId?: string): Promise<Proposal> => {
    const saved = must(
      await db.rpc("commit_proposal_write", {
        p_proposal: proposalToRow(proposal),
        p_events: withIds(events),
        ...(retireListingVersionId ? { p_retire_listing_version_id: retireListingVersionId } : {}),
      }),
    );
    if (!saved) {
      // Someone decided it between our read and this write.
      const latest = await getProposal(proposal.id);
      throw new ProposalWriteError("not_pending", `This proposal was already ${(latest?.status ?? "decided").replace("_", " ")}.`);
    }
    return proposal;
  };

  /** What the listing optimizer reads about one product, shaped like the mock's in-memory store. */
  const runStore = async (productId: string, memberId?: string): Promise<RunStore> => {
    const product = await getProduct(productId);
    const [accountRow, facts, versions, member, running, pending] = await Promise.all([
      product ? db.from("seller_accounts").select().eq("id", product.sellerAccountId).maybeSingle() : null,
      getProductFacts(productId),
      listListingVersions(productId),
      memberId ? writingMember(memberId) : undefined,
      db.from("agent_runs").select().eq("subject_id", productId).eq("status", "running"),
      db.from("proposals").select().eq("target_id", productId).eq("type", "listing_update").eq("status", "pending_approval"),
    ]);
    const account = accountRow ? must(accountRow) : null;
    const workspace = account ? await getWorkspace(account.workspace_id) : undefined;
    const live: ListingVersion | undefined = versions.find((version) => version.status === "live");
    return {
      workspaces: workspace ? [workspace] : [],
      members: member ? [member] : [],
      sellerAccounts: account ? [sellerAccountFromRow(account)] : [],
      products: product ? [product] : [],
      productFacts: facts ? [facts] : [],
      listingVersions: versions,
      proposals: (must(pending) ?? []).map(proposalFromRow),
      agentRuns: (must(running) ?? []).map(agentRunFromRow),
      liveListing: (id) => (id === productId ? live : undefined),
      nextId: { run: () => newId("run"), listingVersion: () => newId("lv"), review: () => newId("rev"), proposal: () => newId("prop") },
    };
  };

  const getMetricsDateRange = async (sellerAccountId: string) => {
    const edge = async (ascending: boolean) =>
      must(
        await db.from("metrics_daily").select("date").eq("seller_account_id", sellerAccountId).order("date", { ascending }).limit(1).maybeSingle(),
      )?.date;
    const [from, to] = await Promise.all([edge(true), edge(false)]);
    return from && to ? { from, to } : undefined;
  };

  /** What the campaign optimizer reads about one campaign, shaped like the mock's in-memory store. */
  const campaignRunStore = async (campaignId: string, memberId?: string): Promise<CampaignRunStore> => {
    const campaignRow = must(await db.from("campaigns").select().eq("id", campaignId).maybeSingle());
    const accountId = campaignRow?.seller_account_id ?? "";
    const [accountRow, campaigns, adGroups, targets, products, facts, available, member, running, pending] = await Promise.all([
      db.from("seller_accounts").select().eq("id", accountId).maybeSingle(),
      selectAll((from, to) => db.from("campaigns").select().eq("seller_account_id", accountId).order("id").range(from, to)),
      selectAll((from, to) => db.from("ad_groups").select().eq("seller_account_id", accountId).order("id").range(from, to)),
      selectAll((from, to) => db.from("targets").select().eq("seller_account_id", accountId).order("id").range(from, to)),
      selectAll((from, to) => db.from("products").select().eq("seller_account_id", accountId).order("id").range(from, to)),
      selectAll((from, to) => db.from("product_facts").select().eq("seller_account_id", accountId).order("product_id").range(from, to)),
      getMetricsDateRange(accountId),
      memberId ? writingMember(memberId) : undefined,
      db.from("agent_runs").select().eq("subject_id", campaignId).eq("status", "running"),
      db.from("proposals").select().eq("target_id", campaignId).eq("type", "campaign_plan").eq("status", "pending_approval"),
    ]);
    const account = must(accountRow);
    const workspace = account ? await getWorkspace(account.workspace_id) : undefined;
    const ownGroupIds = new Set(adGroups.filter((row) => row.campaign_id === campaignId).map((row) => row.id));
    const ownTargetIds = targets.filter((row) => ownGroupIds.has(row.ad_group_id)).map((row) => row.id);
    const window = campaignOptimizerWindow(available);
    const metrics =
      window && ownTargetIds.length > 0
        ? await selectAll((from, to) =>
            db
              .from("metrics_daily")
              .select()
              .eq("seller_account_id", accountId)
              .eq("entity_type", "target")
              .in("entity_id", ownTargetIds)
              .gte("date", window.from)
              .lte("date", window.to)
              .order("date")
              .order("entity_id")
              .range(from, to),
          )
        : [];
    return {
      workspace,
      members: member ? [member] : [],
      account: account ? sellerAccountFromRow(account) : undefined,
      campaign: campaignRow ? campaignFromRow(campaignRow) : undefined,
      campaigns: campaigns.map(campaignFromRow),
      adGroups: adGroups.map(adGroupFromRow),
      targets: targets.map(targetFromRow),
      products: products.map(productFromRow),
      productFacts: facts.map(productFactsFromRow),
      window,
      metrics: metrics.map((row) => metricsDailyFromRow(row) as AdMetricsDaily),
      pendingPlans: (must(pending) ?? []).map(proposalFromRow),
      runningRuns: (must(running) ?? []).map(agentRunFromRow),
      nextId: { run: () => newId("run"), proposal: () => newId("prop") },
    };
  };

  /** What the campaign strategist reads about one seller account, shaped like the mock's in-memory store. */
  const strategistStore = async (sellerAccountId: string, memberId?: string): Promise<StrategistStore> => {
    const [accountRow, products, facts, member, running] = await Promise.all([
      db.from("seller_accounts").select().eq("id", sellerAccountId).maybeSingle(),
      selectAll((from, to) => db.from("products").select().eq("seller_account_id", sellerAccountId).order("id").range(from, to)),
      selectAll((from, to) => db.from("product_facts").select().eq("seller_account_id", sellerAccountId).order("product_id").range(from, to)),
      memberId ? writingMember(memberId) : undefined,
      db.from("agent_runs").select().eq("subject_id", sellerAccountId).eq("agent", "campaign_strategist").eq("status", "running"),
    ]);
    const account = must(accountRow);
    return {
      workspace: account ? await getWorkspace(account.workspace_id) : undefined,
      members: member ? [member] : [],
      account: account ? sellerAccountFromRow(account) : undefined,
      products: products.map(productFromRow),
      productFacts: facts.map(productFactsFromRow),
      runningRuns: (must(running) ?? []).map(agentRunFromRow),
      nextId: { run: () => newId("run"), proposal: () => newId("prop") },
    };
  };

  const scopeOf = (record: { workspaceId: string; sellerAccountId: string }) => ({
    workspaceId: record.workspaceId,
    sellerAccountId: record.sellerAccountId,
  });

  return {
    async listWorkspaces() {
      return (await selectAll((from, to) => db.from("workspaces").select().order("id").range(from, to))).map(workspaceFromRow);
    },
    getWorkspace,
    async updateWorkspaceBranding({ workspaceId, memberId, branding }) {
      const [row, member] = await Promise.all([db.from("workspaces").select().eq("id", workspaceId).maybeSingle(), writingMember(memberId)]);
      const workspace = must(row);
      const result = brandingWrite({ workspace: workspace ? workspaceFromRow(workspace) : undefined, member, at: now().toISOString() }, branding);
      const saved = must(
        await db.rpc("update_workspace_branding", {
          p_workspace_id: workspaceId,
          p_branding: (result.workspace.branding ?? null) as Json,
          p_events: withIds(result.events),
        }),
      );
      if (!saved) throw new SettingsWriteError("forbidden", "Only workspace owners can change report branding.");
      return result.workspace;
    },
    listMembers,
    async getActingMember(workspaceId) {
      const query = db.from("members").select().eq("workspace_id", workspaceId);
      const row = must(
        await (userId !== undefined ? query.eq("user_id", userId) : query.eq("role", "owner").order("created_at"))
          .limit(1)
          .maybeSingle(),
      );
      return row ? memberFromRow(row) : undefined;
    },
    async listSellerAccounts(workspaceId) {
      return (
        await selectAll((from, to) => {
          const query = db.from("seller_accounts").select();
          return (workspaceId ? query.eq("workspace_id", workspaceId) : query).order("id").range(from, to);
        })
      ).map(sellerAccountFromRow);
    },
    getSellerAccount,
    async updateSellerAccountSettings({ sellerAccountId, memberId, ...change }) {
      const [account, member] = await Promise.all([getSellerAccount(sellerAccountId), writingMember(memberId)]);
      const result = accountSettingsWrite({ account, member, at: now().toISOString() }, change);
      settingsSaved(
        must(await db.rpc("update_seller_account_settings", { p_account: sellerAccountToRow(result.account) as Json, p_events: withIds(result.events) })),
        "Only workspace owners can change this.",
      );
      return result.account;
    },
    async connectSellerAccount({ workspaceId, memberId, name, marketplace }) {
      const [workspace, member] = await Promise.all([getWorkspace(workspaceId), writingMember(memberId)]);
      const result = connectAccountWrite(
        { workspace, member, at: now().toISOString(), id: newId("sa"), sellerId: randomSellerId() },
        { name, marketplace },
      );
      must(await db.rpc("connect_seller_account", { p_account: sellerAccountToRow(result.account) as Json, p_events: withIds(result.events) }));
      return result.account;
    },
    async inviteMember({ workspaceId, memberId, ...invite }) {
      const result = inviteMemberWrite({ ...(await teamContext(workspaceId, memberId)), id: newId("mem") }, invite);
      must(await db.rpc("save_member", { p_member: memberToRow(result.member) as Json, p_events: withIds(result.events) }));
      return result.member;
    },
    async updateMember({ memberId, targetMemberId, role, sellerAccountIds }) {
      const target = must(await db.from("members").select().eq("id", targetMemberId).maybeSingle());
      const ctx = await teamContext(target?.workspace_id ?? "", memberId);
      const result = updateMemberWrite({ ...ctx, target: target ? memberFromRow(target) : undefined }, { role, sellerAccountIds });
      must(await db.rpc("save_member", { p_member: memberToRow(result.member) as Json, p_events: withIds(result.events) }));
      return result.member;
    },
    async removeMember({ memberId, targetMemberId }) {
      const target = must(await db.from("members").select().eq("id", targetMemberId).maybeSingle());
      const ctx = await teamContext(target?.workspace_id ?? "", memberId);
      const result = removeMemberWrite({ ...ctx, target: target ? memberFromRow(target) : undefined });
      settingsSaved(
        must(await db.rpc("remove_member", { p_member_id: targetMemberId, p_events: withIds(result.events) })),
        "Only workspace owners can manage the team.",
      );
    },
    async setAgentsPaused({ workspaceId, memberId, paused }) {
      const [workspace, member, running] = await Promise.all([
        getWorkspace(workspaceId),
        writingMember(memberId),
        selectAll((from, to) =>
          db.from("agent_runs").select().eq("workspace_id", workspaceId).in("status", ["queued", "running"]).order("id").range(from, to),
        ),
      ]);
      const at = now().toISOString();
      const result = agentsPausedWrite({ workspace, member, runningRuns: running.map(agentRunFromRow), at }, paused);
      settingsSaved(
        must(
          await db.rpc("set_agents_paused", {
            p_workspace_id: workspaceId,
            p_member_id: memberId,
            // The generated type says string; null resumes.
            p_paused_at: (result.workspace.agentsPausedAt ?? null) as string,
            p_cancel_run_ids: result.cancelledRuns.map((run) => run.id),
            p_finished_at: at,
            p_events: withIds(result.events),
          }),
        ),
        paused ? "Only owners and specialists can pause agents." : "Only workspace owners can resume agents.",
      );
      return result.workspace;
    },

    async listProducts({ sellerAccountId, category, status }) {
      return (
        await selectAll((from, to) => {
          let query = db.from("products").select().eq("seller_account_id", sellerAccountId);
          if (category !== undefined) query = query.eq("category", category);
          if (status !== undefined) query = query.eq("status", status);
          return query.order("id").range(from, to);
        })
      ).map(productFromRow);
    },
    getProduct,
    getProductFacts,
    listListingVersions,
    async listReviews(listingVersionId) {
      return (
        await selectAll((from, to) =>
          db
            .from("reviews")
            .select()
            .eq("listing_version_id", listingVersionId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        )
      ).map(reviewFromRow);
    },
    getReview,
    async listLiveListingReviews(sellerAccountId) {
      const rows = await selectAll((from, to) =>
        db
          .from("reviews")
          .select("*, listing_versions!inner(product_id)")
          .eq("seller_account_id", sellerAccountId)
          .eq("listing_versions.status", "live")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      );
      // Newest first, so the first row seen for a listing is its newest review.
      const newest = new Map<string, LiveListingReview>();
      for (const { listing_versions: version, ...row } of rows) {
        if (!newest.has(row.listing_version_id)) newest.set(row.listing_version_id, { productId: version.product_id, review: reviewFromRow(row) });
      }
      return [...newest.values()].sort((a, b) => a.productId.localeCompare(b.productId));
    },

    async listProposals({ workspaceId, sellerAccountId, status, type, snoozed }) {
      const at = now().toISOString();
      return (
        await selectAll((from, to) => {
          let query = db.from("proposals").select().eq("workspace_id", workspaceId);
          if (sellerAccountId !== undefined) query = query.eq("seller_account_id", sellerAccountId);
          if (status !== undefined) query = query.eq("status", status);
          if (type !== undefined) query = query.eq("type", type);
          if (snoozed === true) query = query.gt("snoozed_until", at);
          if (snoozed === false) query = query.or(`snoozed_until.is.null,snoozed_until.lte."${at}"`);
          return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
        })
      ).map(proposalFromRow);
    },
    getProposal,
    async approveProposal({ proposalId, memberId, note, edits }) {
      return commit(approveProposalWrite(await writeContext(proposalId, memberId), { note, edits }));
    },
    async rejectProposal({ proposalId, memberId, reason }) {
      const result = rejectProposalWrite(await writeContext(proposalId, memberId), { reason });
      // The agent's draft behind a rejected listing update will never go live.
      const review = result.proposal.reviewId ? await getReview(result.proposal.reviewId) : undefined;
      return commit(result, review?.listingVersionId);
    },
    async snoozeProposal({ proposalId, memberId, until }) {
      return commit(snoozeProposalWrite(await writeContext(proposalId, memberId), { until }));
    },

    async listCampaigns(sellerAccountId) {
      return (
        await selectAll((from, to) =>
          db.from("campaigns").select().eq("seller_account_id", sellerAccountId).order("id").range(from, to),
        )
      ).map(campaignFromRow);
    },
    async getCampaign(id) {
      const row = must(await db.from("campaigns").select().eq("id", id).maybeSingle());
      return row ? campaignFromRow(row) : undefined;
    },
    async listAdGroups(campaignId) {
      return (
        await selectAll((from, to) => db.from("ad_groups").select().eq("campaign_id", campaignId).order("id").range(from, to))
      ).map(adGroupFromRow);
    },
    async getAdGroup(id) {
      const row = must(await db.from("ad_groups").select().eq("id", id).maybeSingle());
      return row ? adGroupFromRow(row) : undefined;
    },
    async listTargets(adGroupId) {
      return (
        await selectAll((from, to) => db.from("targets").select().eq("ad_group_id", adGroupId).order("id").range(from, to))
      ).map(targetFromRow);
    },
    async getTarget(id) {
      const row = must(await db.from("targets").select().eq("id", id).maybeSingle());
      return row ? targetFromRow(row) : undefined;
    },
    async listMetricsDaily<T extends MetricsDaily["entityType"]>({
      sellerAccountId,
      entityType,
      entityIds,
      range,
    }: {
      sellerAccountId: string;
      entityType: T;
      entityIds?: string[];
      range?: { from: string; to: string };
    }) {
      const rows = await selectAll((from, to) => {
        let query = db.from("metrics_daily").select().eq("seller_account_id", sellerAccountId).eq("entity_type", entityType);
        if (entityIds !== undefined) query = query.in("entity_id", entityIds);
        if (range !== undefined) query = query.gte("date", range.from).lte("date", range.to);
        return query.order("date").order("entity_id").range(from, to);
      });
      return rows.map((row) => metricsDailyFromRow(row) as Extract<MetricsDaily, { entityType: T }>);
    },
    getMetricsDateRange,

    async listAgentRuns({ workspaceId, sellerAccountId, subjectId, limit }) {
      return (
        await selectAll((from, to) => {
          let query = db.from("agent_runs").select().eq("workspace_id", workspaceId);
          if (sellerAccountId !== undefined) query = query.eq("seller_account_id", sellerAccountId);
          if (subjectId !== undefined) query = query.eq("subject_id", subjectId);
          return query.order("started_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
        }, limit)
      ).map(agentRunFromRow);
    },
    getAgentRun,
    async startListingOptimizer({ productId, memberId }) {
      const { run, events } = startListingOptimizerRun(await runStore(productId, memberId), { productId, memberId, at: now() });
      const { error } = await db.rpc("start_agent_run", { p_run: agentRunToRow(run), p_events: withIds(events) });
      if (error?.code === UNIQUE_VIOLATION) throw new AgentRunError("conflict", "The optimizer is already running on this product.");
      must({ data: null, error });
      return run;
    },
    async startCampaignOptimizer({ campaignId, memberId }) {
      const { run, events } = startCampaignOptimizerRun(await campaignRunStore(campaignId, memberId), { campaignId, memberId, at: now() });
      const { error } = await db.rpc("start_agent_run", { p_run: agentRunToRow(run), p_events: withIds(events) });
      if (error?.code === UNIQUE_VIOLATION) throw new AgentRunError("conflict", "The optimizer is already running on this campaign.");
      must({ data: null, error });
      return run;
    },
    async startCampaignStrategist({ sellerAccountId, memberId, brief }) {
      const { run, events } = startCampaignStrategistRun(await strategistStore(sellerAccountId, memberId), { sellerAccountId, memberId, brief, at: now() });
      const { error } = await db.rpc("start_agent_run", { p_run: agentRunToRow(run), p_events: withIds(events) });
      if (error?.code === UNIQUE_VIOLATION) throw new AgentRunError("conflict", "The strategist is already planning campaigns for this account.");
      must({ data: null, error });
      return run;
    },
    async completeAgentRun(runId) {
      const run = await getAgentRun(runId);
      if (!run) throw new AgentRunError("not_found", "That agent run doesn't exist.");
      const finished = async (latest: typeof run) => {
        const proposalId = latest.proposalIds[0];
        return { run: latest, proposal: proposalId ? await getProposal(proposalId) : undefined };
      };
      if (run.status !== "running") return finished(run);
      // Another request completed it first; return what that one filed.
      const filedElsewhere = async () => {
        const latest = await getAgentRun(runId);
        if (!latest) throw new AgentRunError("not_found", "That agent run doesn't exist.");
        return finished(latest);
      };

      if (run.agent === "campaign_optimizer") {
        const result = completeCampaignOptimizerRun(await campaignRunStore(run.subject?.id ?? ""), run, now().toISOString());
        const { data: filed, error } = await db.rpc("finish_agent_run", {
          p_run: agentRunToRow(result.run),
          p_events: withIds(result.events),
          ...(result.proposal ? { p_proposal: proposalToRow(result.proposal) } : {}),
        });
        if (error?.code === UNIQUE_VIOLATION) {
          throw new AgentRunError("conflict", "A plan for this campaign is already waiting for approval.");
        }
        if (!must({ data: filed, error })) return filedElsewhere();
        return { run: result.run, proposal: result.proposal };
      }
      if (run.agent === "campaign_strategist") {
        const result = completeCampaignStrategistRun(await strategistStore(run.sellerAccountId), run, now().toISOString());
        const { data: filed, error } = await db.rpc("finish_agent_run", {
          p_run: agentRunToRow(result.run),
          p_events: withIds(result.events),
          ...(result.proposal ? { p_proposal: proposalToRow(result.proposal) } : {}),
        });
        if (!must({ data: filed, error })) return filedElsewhere();
        return { run: result.run, proposal: result.proposal };
      }

      const store = await runStore(run.subject?.id ?? "");
      const result = completeListingOptimizerRun(store, run, now().toISOString());
      const scope = scopeOf(run);
      // At L0 the run files nothing: it only finishes.
      const { data: filed, error } =
        result.version && result.review && result.proposal
          ? await db.rpc("file_agent_run_output", {
              p_run: agentRunToRow(result.run),
              p_listing_version: listingVersionToRow(result.version, scope),
              p_review: reviewToRow(result.review, scope),
              p_proposal: proposalToRow(result.proposal),
              p_events: withIds(result.events),
            })
          : await db.rpc("finish_agent_run", { p_run: agentRunToRow(result.run), p_events: withIds(result.events) });
      if (error?.code === UNIQUE_VIOLATION) {
        throw new AgentRunError("conflict", "A listing proposal for this product is already waiting for approval.");
      }
      if (!must({ data: filed, error })) return filedElsewhere();
      return { run: result.run, proposal: result.proposal };
    },
    async listAuditEvents({ workspaceId, sellerAccountId, limit }) {
      return (
        await selectAll((from, to) => {
          const query = db.from("audit_events").select().eq("workspace_id", workspaceId);
          return (sellerAccountId !== undefined ? query.eq("seller_account_id", sellerAccountId) : query)
            .order("at", { ascending: false })
            .order("seq", { ascending: false })
            .range(from, to);
        }, limit)
      ).map(auditEventFromRow);
    },
  };
}
