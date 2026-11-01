-- Tables for every schema in packages/core. Zod there is the source of truth: enum values below are
-- checked against it by packages/data/src/supabase/schema-drift.test.ts, and rows are parsed with
-- the Zod schemas on the way out. Constraints here repeat the invariants that matter for integrity.
--
-- Every account-scoped table carries workspace_id and seller_account_id, tied together by composite
-- foreign keys, so row-level security can check them on the row itself without joins.

create schema if not exists private;

-- Enums ------------------------------------------------------------------------------------------

create type public.workspace_kind as enum ('merchant', 'agency');
create type public.member_role as enum ('owner', 'specialist', 'client_approver', 'viewer');
create type public.marketplace as enum ('US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP');
create type public.currency as enum ('USD', 'CAD', 'MXN', 'GBP', 'EUR', 'JPY');
create type public.autonomy_level as enum ('L0', 'L1', 'L2', 'L3');
create type public.entity_type as enum (
  'workspace', 'member', 'seller_account', 'product', 'listing_version', 'review', 'proposal',
  'campaign', 'ad_group', 'target', 'agent_run'
);
create type public.agent_name as enum (
  'listing_writer', 'listing_reviewer', 'bid_optimizer', 'budget_pacer', 'keyword_harvester'
);
create type public.product_status as enum ('active', 'inactive', 'suppressed');
create type public.listing_version_status as enum ('draft', 'proposed', 'live', 'superseded', 'rejected');
create type public.ad_state as enum ('enabled', 'paused', 'archived');
create type public.campaign_type as enum ('sponsored_products', 'sponsored_brands', 'sponsored_display');
create type public.targeting_type as enum ('auto', 'manual');
create type public.bidding_strategy as enum ('fixed', 'dynamic_down_only', 'dynamic_up_and_down');
create type public.target_kind as enum ('keyword', 'product', 'auto');
create type public.match_type as enum ('exact', 'phrase', 'broad');
create type public.auto_target_type as enum ('close_match', 'loose_match', 'substitutes', 'complements');
create type public.metrics_entity_type as enum ('product', 'campaign', 'target');
create type public.proposal_type as enum (
  'listing_update', 'price_change', 'bid_change', 'budget_change', 'keyword_add', 'keyword_negate', 'target_pause'
);
create type public.proposal_status as enum (
  'pending_approval', 'approved', 'rejected', 'applied', 'failed', 'superseded'
);
create type public.proposal_risk as enum ('low', 'medium', 'high');
create type public.agent_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.agent_run_trigger as enum ('schedule', 'manual', 'event');
create type public.audit_action as enum (
  'agent_run.started', 'agent_run.finished', 'proposal.created', 'proposal.edited', 'proposal.snoozed',
  'proposal.approved', 'proposal.rejected', 'proposal.applied', 'proposal.failed',
  'listing_version.published', 'member.invited', 'seller_account.connected', 'settings.updated'
);

-- An Actor (packages/core common.ts): a member, an agent run or the system.
create function private.is_actor(actor jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select case actor ->> 'type'
    when 'member' then jsonb_typeof(actor -> 'memberId') = 'string'
    when 'agent' then (actor ->> 'agent')::public.agent_name is not null
      and jsonb_typeof(actor -> 'agentRunId') = 'string'
    when 'system' then true
    else false
  end
$$;

create function private.is_nonempty_array(value jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0
$$;

-- Workspaces and members -------------------------------------------------------------------------

create table public.workspaces (
  id text primary key,
  name text not null check (name <> ''),
  kind public.workspace_kind not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id text primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  -- The auth user who signs in as this member; linked by email (see the auth_members migration).
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (name <> ''),
  email text not null check (email like '_%@_%'),
  role public.member_role not null,
  -- Accounts this member is limited to. Empty means every account in the workspace.
  seller_account_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (workspace_id, user_id),
  constraint client_approver_is_scoped check (role <> 'client_approver' or cardinality(seller_account_ids) > 0)
);
create index members_user_id_idx on public.members (user_id);

create table public.seller_accounts (
  id text primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  name text not null check (name <> ''),
  seller_id text not null check (seller_id ~ '^A[0-9A-Z]{12,13}$'),
  marketplace public.marketplace not null,
  currency public.currency not null,
  autonomy_level public.autonomy_level not null,
  connected_at timestamptz not null,
  unique (id, workspace_id)
);
create index seller_accounts_workspace_id_idx on public.seller_accounts (workspace_id);

-- Catalog ----------------------------------------------------------------------------------------

create table public.products (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  asin text not null check (asin ~ '^B0[0-9A-Z]{8}$'),
  sku text not null check (sku <> ''),
  title text not null check (title <> ''),
  brand text not null check (brand <> ''),
  category text not null check (category <> ''),
  price numeric(12, 2) not null check (price >= 0),
  status public.product_status not null,
  created_at timestamptz not null,
  foreign key (seller_account_id, workspace_id) references public.seller_accounts (id, workspace_id) on delete cascade,
  unique (id, seller_account_id, workspace_id)
);
create index products_seller_account_id_idx on public.products (seller_account_id);

-- Ground truth about a product. Agents may only claim what is in here.
create table public.product_facts (
  product_id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  material text not null check (material <> ''),
  color text not null check (color <> ''),
  length_cm numeric not null check (length_cm > 0),
  width_cm numeric not null check (width_cm > 0),
  height_cm numeric not null check (height_cm > 0),
  weight_grams numeric not null check (weight_grams > 0),
  included_components text[] not null check (cardinality(included_components) > 0),
  features text[] not null check (cardinality(features) > 0),
  prohibited_claims text[] not null default '{}',
  target_keywords text[] not null default '{}',
  updated_at timestamptz not null,
  foreign key (product_id, seller_account_id, workspace_id)
    references public.products (id, seller_account_id, workspace_id) on delete cascade
);

-- Limits match LISTING_LIMITS in packages/core catalog.ts.
create table public.listing_versions (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  product_id text not null,
  version integer not null check (version > 0),
  status public.listing_version_status not null,
  title text not null check (char_length(title) between 1 and 200),
  bullets text[] not null check (cardinality(bullets) between 1 and 5),
  description text not null check (char_length(description) <= 2000),
  backend_keywords text not null check (octet_length(backend_keywords) <= 249),
  created_by jsonb not null check (private.is_actor(created_by)),
  created_at timestamptz not null,
  foreign key (product_id, seller_account_id, workspace_id)
    references public.products (id, seller_account_id, workspace_id) on delete cascade,
  unique (product_id, version),
  unique (id, seller_account_id, workspace_id)
);
create index listing_versions_product_id_idx on public.listing_versions (product_id);
-- A product has at most one live listing.
create unique index listing_versions_one_live_idx on public.listing_versions (product_id) where status = 'live';

-- A rubric evaluation of one ListingVersion.
create table public.reviews (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  listing_version_id text not null,
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  overall integer not null check (overall between 0 and 100),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  reviewer jsonb not null check (private.is_actor(reviewer)),
  created_at timestamptz not null,
  foreign key (listing_version_id, seller_account_id, workspace_id)
    references public.listing_versions (id, seller_account_id, workspace_id) on delete cascade
);
create index reviews_listing_version_id_idx on public.reviews (listing_version_id);

-- Advertising ------------------------------------------------------------------------------------

create table public.campaigns (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  name text not null check (name <> ''),
  type public.campaign_type not null,
  targeting_type public.targeting_type not null,
  state public.ad_state not null,
  daily_budget numeric(12, 2) not null check (daily_budget > 0),
  bidding_strategy public.bidding_strategy not null,
  start_date date not null,
  end_date date,
  foreign key (seller_account_id, workspace_id) references public.seller_accounts (id, workspace_id) on delete cascade,
  unique (id, seller_account_id, workspace_id)
);
create index campaigns_seller_account_id_idx on public.campaigns (seller_account_id);

create table public.ad_groups (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  campaign_id text not null,
  name text not null check (name <> ''),
  state public.ad_state not null,
  default_bid numeric(12, 2) not null check (default_bid > 0),
  -- Products advertised in this ad group.
  product_ids text[] not null check (cardinality(product_ids) > 0),
  foreign key (campaign_id, seller_account_id, workspace_id)
    references public.campaigns (id, seller_account_id, workspace_id) on delete cascade,
  unique (id, seller_account_id, workspace_id)
);
create index ad_groups_campaign_id_idx on public.ad_groups (campaign_id);

-- One table for the Target union: the kind decides which of keyword, asin and auto_type is set.
create table public.targets (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  ad_group_id text not null,
  state public.ad_state not null,
  negative boolean not null,
  bid numeric(12, 2) check (bid > 0),
  kind public.target_kind not null,
  keyword text check (keyword <> ''),
  match_type public.match_type,
  asin text check (asin ~ '^B0[0-9A-Z]{8}$'),
  auto_type public.auto_target_type,
  foreign key (ad_group_id, seller_account_id, workspace_id)
    references public.ad_groups (id, seller_account_id, workspace_id) on delete cascade,
  -- Negative targets block traffic and have no bid; positive ones need one.
  constraint bid_matches_negative check (negative = (bid is null)),
  constraint fields_match_kind check (
    case kind
      when 'keyword' then keyword is not null and match_type is not null and asin is null and auto_type is null
      when 'product' then asin is not null and keyword is null and match_type is null and auto_type is null
      when 'auto' then auto_type is not null and keyword is null and match_type is null and asin is null
    end
  )
);
create index targets_ad_group_id_idx on public.targets (ad_group_id);

-- One entity's numbers for one day. Products have traffic and sales; campaigns and targets have ad metrics.
create table public.metrics_daily (
  workspace_id text not null,
  seller_account_id text not null,
  entity_type public.metrics_entity_type not null,
  entity_id text not null,
  date date not null,
  sessions integer check (sessions >= 0),
  page_views integer check (page_views >= 0),
  units_ordered integer check (units_ordered >= 0),
  ordered_revenue numeric(14, 2) check (ordered_revenue >= 0),
  impressions integer check (impressions >= 0),
  clicks integer check (clicks >= 0),
  spend numeric(14, 2) check (spend >= 0),
  ad_sales numeric(14, 2) check (ad_sales >= 0),
  ad_orders integer check (ad_orders >= 0),
  primary key (seller_account_id, entity_type, entity_id, date),
  foreign key (seller_account_id, workspace_id) references public.seller_accounts (id, workspace_id) on delete cascade,
  constraint fields_match_entity_type check (
    case entity_type
      when 'product' then num_nonnulls(sessions, page_views, units_ordered, ordered_revenue) = 4
        and num_nonnulls(impressions, clicks, spend, ad_sales, ad_orders) = 0
        and page_views >= sessions
      else num_nonnulls(impressions, clicks, spend, ad_sales, ad_orders) = 5
        and num_nonnulls(sessions, page_views, units_ordered, ordered_revenue) = 0
        and clicks <= impressions
        and ad_orders <= clicks
    end
  )
);

-- Proposals --------------------------------------------------------------------------------------

-- Any change to Amazon or to spend. Nothing is applied until a Proposal is approved.
create table public.proposals (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  type public.proposal_type not null,
  status public.proposal_status not null,
  risk public.proposal_risk not null,
  title text not null check (title <> ''),
  rationale text not null check (rationale <> ''),
  target_type public.entity_type not null,
  target_id text not null,
  diff jsonb not null check (private.is_nonempty_array(diff)),
  -- The agent's diff, kept when a member edited `diff` before approving.
  original_diff jsonb check (original_diff is null or private.is_nonempty_array(original_diff)),
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  freshness jsonb not null check (private.is_nonempty_array(freshness)),
  review_id text references public.reviews (id) on delete set null,
  created_by jsonb not null check (private.is_actor(created_by)),
  created_at timestamptz not null,
  snoozed_until timestamptz,
  decided_by jsonb check (decided_by is null or private.is_actor(decided_by)),
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  foreign key (seller_account_id, workspace_id) references public.seller_accounts (id, workspace_id) on delete cascade,
  constraint decided_needs_decider check (
    status not in ('approved', 'rejected', 'applied', 'failed') or (decided_by is not null and decided_at is not null)
  ),
  constraint applied_at_iff_applied check ((status = 'applied') = (applied_at is not null)),
  constraint only_pending_snoozes check (snoozed_until is null or status = 'pending_approval'),
  constraint member_rejection_has_reason check (
    status <> 'rejected' or decided_by ->> 'type' <> 'member' or coalesce(btrim(decision_note), '') <> ''
  )
);
create index proposals_queue_idx on public.proposals (workspace_id, status, created_at desc);
create index proposals_target_id_idx on public.proposals (target_id);
-- One listing rewrite waits for approval per product at a time.
create unique index proposals_one_pending_listing_idx on public.proposals (target_id)
  where type = 'listing_update' and status = 'pending_approval';

-- Agent runs and audit ---------------------------------------------------------------------------

-- One execution of an agent against a seller account.
create table public.agent_runs (
  id text primary key,
  workspace_id text not null,
  seller_account_id text not null,
  agent public.agent_name not null,
  status public.agent_run_status not null,
  autonomy_level public.autonomy_level not null,
  trigger public.agent_run_trigger not null,
  subject_type public.entity_type,
  subject_id text,
  summary text not null default '',
  proposal_ids text[] not null default '{}',
  -- Timeline of the run (AgentRunStep[]), when the agent recorded one.
  steps jsonb check (steps is null or jsonb_typeof(steps) = 'array'),
  started_at timestamptz not null,
  finished_at timestamptz,
  error text,
  foreign key (seller_account_id, workspace_id) references public.seller_accounts (id, workspace_id) on delete cascade,
  constraint subject_is_complete check ((subject_type is null) = (subject_id is null)),
  constraint finished_at_iff_finished check (
    (status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)
  ),
  constraint error_iff_failed check ((status = 'failed') = (error is not null))
);
create index agent_runs_feed_idx on public.agent_runs (workspace_id, started_at desc);
create index agent_runs_subject_id_idx on public.agent_runs (subject_id);
-- An agent works on one subject at a time.
create unique index agent_runs_one_running_idx on public.agent_runs (subject_type, subject_id)
  where status = 'running' and subject_id is not null;

-- Append-only record of who did what. `seq` orders events that share a timestamp.
create table public.audit_events (
  id text primary key,
  seq bigint generated always as identity unique,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  seller_account_id text,
  at timestamptz not null,
  actor jsonb not null check (private.is_actor(actor)),
  action public.audit_action not null,
  entity_type public.entity_type not null,
  entity_id text not null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  foreign key (seller_account_id, workspace_id) references public.seller_accounts (id, workspace_id) on delete cascade
);
create index audit_events_feed_idx on public.audit_events (workspace_id, at desc, seq desc);
