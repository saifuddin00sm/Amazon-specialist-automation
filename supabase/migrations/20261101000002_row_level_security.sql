-- Row-level security keyed on workspace_id and the member's role (owner, specialist,
-- client_approver, viewer), mirroring canActOnAccount in packages/core permissions.ts:
--
--   * Every member reads their workspace. A member scoped to some seller accounts (a client
--     approver) only sees those accounts' rows; an unscoped member sees every account.
--   * Owners, specialists and client approvers act on the accounts they see: they decide
--     proposals and file agent output. Viewers only read.
--   * Owners manage the workspace, its members and account settings.
--   * Live catalog and advertising data has no write policy: it changes through approved
--     Proposals applied by the backend, never from the app.
--   * Audit events are append-only; members can't record events as another member.
--
-- The helpers return arrays and are called as `(select private.fn())` so Postgres evaluates them
-- once per statement instead of once per row. The `::text[]` cast keeps `= any (...)` in its array
-- form; without it Postgres reads the subquery as a set of rows.

-- Helpers ----------------------------------------------------------------------------------------

create function private.my_workspace_ids() returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(workspace_id), '{}') from public.members where user_id = (select auth.uid())
$$;

create function private.my_member_ids() returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.members where user_id = (select auth.uid())
$$;

create function private.owned_workspace_ids() returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(workspace_id), '{}')
  from public.members
  where user_id = (select auth.uid()) and role = 'owner'
$$;

-- Workspaces where the user sees every seller account, not just some.
create function private.unscoped_workspace_ids() returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(workspace_id), '{}')
  from public.members
  where user_id = (select auth.uid()) and cardinality(seller_account_ids) = 0
$$;

create function private.visible_account_ids() returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct account.id), '{}')
  from public.members member
  join public.seller_accounts account on account.workspace_id = member.workspace_id
  where member.user_id = (select auth.uid())
    and (cardinality(member.seller_account_ids) = 0 or account.id = any (member.seller_account_ids))
$$;

-- Accounts the user may act on: visible ones, unless they are a viewer there.
create function private.actionable_account_ids() returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct account.id), '{}')
  from public.members member
  join public.seller_accounts account on account.workspace_id = member.workspace_id
  where member.user_id = (select auth.uid())
    and member.role <> 'viewer'
    and (cardinality(member.seller_account_ids) = 0 or account.id = any (member.seller_account_ids))
$$;

-- An Actor the user may record: an agent or the system, or themselves as a member.
create function private.may_record_actor(actor jsonb) returns boolean
language sql stable
set search_path = ''
as $$
  select actor ->> 'type' <> 'member' or actor ->> 'memberId' = any ((select private.my_member_ids())::text[])
$$;

grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- Table privileges -------------------------------------------------------------------------------
-- RLS decides which rows; grants decide which statements and columns. Anonymous users get nothing.

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

grant update (name) on public.workspaces to authenticated;
grant insert, delete on public.members to authenticated;
grant update (name, role, seller_account_ids) on public.members to authenticated;
grant update (name, autonomy_level) on public.seller_accounts to authenticated;
grant insert on public.listing_versions, public.reviews, public.proposals, public.agent_runs, public.audit_events
  to authenticated;
grant update (status) on public.listing_versions to authenticated;
grant update (status, diff, original_diff, snoozed_until, decided_by, decided_at, decision_note)
  on public.proposals to authenticated;
grant update (status, summary, proposal_ids, steps, finished_at, error) on public.agent_runs to authenticated;

-- Policies ---------------------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.seller_accounts enable row level security;
alter table public.products enable row level security;
alter table public.product_facts enable row level security;
alter table public.listing_versions enable row level security;
alter table public.reviews enable row level security;
alter table public.campaigns enable row level security;
alter table public.ad_groups enable row level security;
alter table public.targets enable row level security;
alter table public.metrics_daily enable row level security;
alter table public.proposals enable row level security;
alter table public.agent_runs enable row level security;
alter table public.audit_events enable row level security;

create policy "members read their workspaces" on public.workspaces
  for select to authenticated
  using (id = any ((select private.my_workspace_ids())::text[]));

create policy "owners rename their workspaces" on public.workspaces
  for update to authenticated
  using (id = any ((select private.owned_workspace_ids())::text[]))
  with check (id = any ((select private.owned_workspace_ids())::text[]));

-- Scoped members (client approvers) see the agency's staff and members of their own accounts,
-- but not the other clients' approvers.
create policy "members read members who share an account" on public.members
  for select to authenticated
  using (
    workspace_id = any ((select private.my_workspace_ids())::text[])
    and (cardinality(seller_account_ids) = 0 or seller_account_ids && (select private.visible_account_ids()))
  );

create policy "owners add members" on public.members
  for insert to authenticated
  with check (workspace_id = any ((select private.owned_workspace_ids())::text[]));

create policy "owners change members" on public.members
  for update to authenticated
  using (workspace_id = any ((select private.owned_workspace_ids())::text[]))
  with check (workspace_id = any ((select private.owned_workspace_ids())::text[]));

create policy "owners remove members" on public.members
  for delete to authenticated
  using (workspace_id = any ((select private.owned_workspace_ids())::text[]));

create policy "members read visible accounts" on public.seller_accounts
  for select to authenticated
  using (
    workspace_id = any ((select private.my_workspace_ids())::text[])
    and id = any ((select private.visible_account_ids())::text[])
  );

create policy "owners change account settings" on public.seller_accounts
  for update to authenticated
  using (workspace_id = any ((select private.owned_workspace_ids())::text[]))
  with check (workspace_id = any ((select private.owned_workspace_ids())::text[]));

-- Reads on every account-scoped table follow the same rule.
do $$
declare
  scoped_table text;
begin
  foreach scoped_table in array array[
    'products', 'product_facts', 'listing_versions', 'reviews', 'campaigns', 'ad_groups', 'targets',
    'metrics_daily', 'proposals', 'agent_runs'
  ] loop
    execute format(
      'create policy "members read visible accounts" on public.%I for select to authenticated using (
         workspace_id = any ((select private.my_workspace_ids())::text[])
         and seller_account_id = any ((select private.visible_account_ids())::text[])
       )',
      scoped_table
    );
  end loop;
end
$$;

-- Agent output: a draft ListingVersion, its Review and a pending Proposal.
create policy "actors file listing drafts" on public.listing_versions
  for insert to authenticated
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and status in ('draft', 'proposed')
    and private.may_record_actor(created_by)
  );

-- Rejecting a listing proposal retires its draft. Publishing happens in the backend.
create policy "actors retire listing drafts" on public.listing_versions
  for update to authenticated
  using (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status = 'proposed')
  with check (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status in ('proposed', 'rejected'));

create policy "actors file reviews" on public.reviews
  for insert to authenticated
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and private.may_record_actor(reviewer)
  );

create policy "actors file pending proposals" on public.proposals
  for insert to authenticated
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and status = 'pending_approval'
    and decided_by is null
    and private.may_record_actor(created_by)
  );

-- Approve, reject or snooze a pending proposal, as yourself. Applying it is the backend's job.
create policy "actors decide pending proposals" on public.proposals
  for update to authenticated
  using (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status = 'pending_approval')
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and status in ('pending_approval', 'approved', 'rejected')
    and (decided_by is null or (decided_by ->> 'type' = 'member' and private.may_record_actor(decided_by)))
  );

create policy "actors start agent runs" on public.agent_runs
  for insert to authenticated
  with check (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status in ('queued', 'running'));

create policy "actors finish agent runs" on public.agent_runs
  for update to authenticated
  using (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status in ('queued', 'running'))
  with check (seller_account_id = any ((select private.actionable_account_ids())::text[]));

-- Workspace-level events (no seller account) are for unscoped members only.
create policy "members read events of visible accounts" on public.audit_events
  for select to authenticated
  using (
    workspace_id = any ((select private.my_workspace_ids())::text[])
    and case
      when seller_account_id is null then workspace_id = any ((select private.unscoped_workspace_ids())::text[])
      else seller_account_id = any ((select private.visible_account_ids())::text[])
    end
  );

create policy "actors append events" on public.audit_events
  for insert to authenticated
  with check (
    case
      when seller_account_id is null then workspace_id = any ((select private.owned_workspace_ids())::text[])
      else seller_account_id = any ((select private.actionable_account_ids())::text[])
    end
    and private.may_record_actor(actor)
  );
