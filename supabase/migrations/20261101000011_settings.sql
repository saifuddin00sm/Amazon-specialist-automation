-- Settings: per-account guardrails and autonomy, the workspace kill switch, connecting seller
-- accounts and managing the team. The rules live in packages/data (settings-writes.ts); the
-- database repeats the ones that matter for safety: only owners change settings, and while agents
-- are paused nothing starts or gets filed, and auto-approval needs the account's autonomy at L2+.

-- Columns ----------------------------------------------------------------------------------------

-- GuardrailsSchema and AutonomyByActionSchema in packages/core workspace.ts; Zod validates both.
alter table public.seller_accounts
  add column guardrails jsonb check (guardrails is null or jsonb_typeof(guardrails) = 'object'),
  add column autonomy_by_action jsonb check (autonomy_by_action is null or jsonb_typeof(autonomy_by_action) = 'object');
grant update (guardrails, autonomy_by_action) on public.seller_accounts to authenticated;

-- The kill switch. No column grant: pausing goes through set_agents_paused, which also lets
-- specialists pause (they can't otherwise update the workspace row).
alter table public.workspaces
  add column agents_paused_at timestamptz,
  add column agents_paused_by text,
  add constraint agents_paused_together check ((agents_paused_at is null) = (agents_paused_by is null));

-- Helpers ----------------------------------------------------------------------------------------

create function private.agents_paused(p_workspace_id text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select agents_paused_at is not null from public.workspaces where id = p_workspace_id), false)
$$;

-- An account's autonomy for one action type: its override, or the account's level.
create function private.autonomy_for(p_seller_account_id text, p_type public.proposal_type) returns public.autonomy_level
language sql stable security definer
set search_path = ''
as $$
  select coalesce((account.autonomy_by_action ->> p_type::text)::public.autonomy_level, account.autonomy_level)
  from public.seller_accounts as account
  where account.id = p_seller_account_id
$$;

revoke all on function private.agents_paused(text) from public;
revoke all on function private.autonomy_for(text, public.proposal_type) from public;
grant execute on function private.agents_paused(text) to authenticated, service_role;
grant execute on function private.autonomy_for(text, public.proposal_type) to authenticated, service_role;

-- Policies ---------------------------------------------------------------------------------------

-- Owners connect seller accounts to their workspaces.
grant insert on public.seller_accounts to authenticated;
create policy "owners connect accounts" on public.seller_accounts
  for insert to authenticated
  with check (workspace_id = any ((select private.owned_workspace_ids())::text[]));

-- The kill switch, enforced where agent output lands: no new runs, no new proposals.
drop policy "actors start agent runs" on public.agent_runs;
create policy "actors start agent runs" on public.agent_runs
  for insert to authenticated
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and status in ('queued', 'running')
    and not private.agents_paused(workspace_id)
  );

drop policy "actors file pending proposals" on public.proposals;
create policy "actors file pending proposals" on public.proposals
  for insert to authenticated
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and status = 'pending_approval'
    and decided_by is null
    and private.may_record_actor(created_by)
    and not private.agents_paused(workspace_id)
  );

-- At L2 and L3 the system approves an agent's proposal as it is filed. Only for an agent's
-- proposal, only when the account's autonomy for that type allows it, and never while paused.
create policy "agents file auto-approved proposals" on public.proposals
  for insert to authenticated
  with check (
    seller_account_id = any ((select private.actionable_account_ids())::text[])
    and status = 'approved'
    and decided_by ->> 'type' = 'system'
    and created_by ->> 'type' = 'agent'
    and private.autonomy_for(seller_account_id, type) in ('L2', 'L3')
    and not private.agents_paused(workspace_id)
  );

-- Writes -----------------------------------------------------------------------------------------
-- Like the others in 20261101000003: commit a row and its audit events in one transaction, as the
-- caller (RLS applies). Each returns false when the row wasn't there to change.

create function public.update_seller_account_settings(p_account jsonb, p_events jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_next public.seller_accounts := jsonb_populate_record(null::public.seller_accounts, p_account);
begin
  update public.seller_accounts as account
  set autonomy_level = v_next.autonomy_level,
      autonomy_by_action = v_next.autonomy_by_action,
      guardrails = v_next.guardrails
  where account.id = v_next.id;
  if not found then
    return false;
  end if;
  perform private.append_audit_events(p_events);
  return true;
end
$$;

create function public.connect_seller_account(p_account jsonb, p_events jsonb) returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  insert into public.seller_accounts select * from jsonb_populate_record(null::public.seller_accounts, p_account);
  perform private.append_audit_events(p_events);
end
$$;

-- Invites a member, or changes an existing one's role and account scope.
create function public.save_member(p_member jsonb, p_events jsonb) returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_member public.members := jsonb_populate_record(null::public.members, p_member);
begin
  insert into public.members (id, workspace_id, name, email, role, seller_account_ids, created_at)
  values (v_member.id, v_member.workspace_id, v_member.name, v_member.email, v_member.role, v_member.seller_account_ids, v_member.created_at)
  on conflict (id) do update
  set role = excluded.role,
      seller_account_ids = excluded.seller_account_ids;
  perform private.append_audit_events(p_events);
end
$$;

create function public.remove_member(p_member_id text, p_events jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
begin
  delete from public.members where id = p_member_id;
  if not found then
    return false;
  end if;
  perform private.append_audit_events(p_events);
  return true;
end
$$;

-- Pauses (p_paused_at set) or resumes (null) the workspace's agents, cancelling the runs named in
-- p_cancel_run_ids. Security definer so specialists can pause; it checks the caller itself: the
-- member must be the signed-in user (or the caller has the secret key), an owner or specialist to
-- pause, an owner to resume. Returns false when refused, writing nothing.
create function public.set_agents_paused(
  p_workspace_id text,
  p_member_id text,
  p_paused_at timestamptz,
  p_cancel_run_ids text[],
  p_finished_at timestamptz,
  p_events jsonb
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  -- anon can't execute this; a caller without a user is the secret key.
  select member.role into v_role
  from public.members as member
  where member.id = p_member_id
    and member.workspace_id = p_workspace_id
    and ((select auth.uid()) is null or member.user_id = (select auth.uid()));
  if v_role is null
    or (p_paused_at is not null and v_role not in ('owner', 'specialist'))
    or (p_paused_at is null and v_role <> 'owner') then
    return false;
  end if;

  update public.workspaces
  set agents_paused_at = p_paused_at,
      agents_paused_by = case when p_paused_at is null then null else p_member_id end
  where id = p_workspace_id;

  update public.agent_runs
  set status = 'cancelled', finished_at = p_finished_at, summary = 'Cancelled: agents were paused.'
  where workspace_id = p_workspace_id and id = any (p_cancel_run_ids) and status in ('queued', 'running');

  perform private.append_audit_events(p_events);
  return true;
end
$$;

revoke all on function public.update_seller_account_settings(jsonb, jsonb) from public, anon;
revoke all on function public.connect_seller_account(jsonb, jsonb) from public, anon;
revoke all on function public.save_member(jsonb, jsonb) from public, anon;
revoke all on function public.remove_member(text, jsonb) from public, anon;
revoke all on function public.set_agents_paused(text, text, timestamptz, text[], timestamptz, jsonb) from public, anon;
grant execute on function public.update_seller_account_settings(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.connect_seller_account(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.save_member(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.remove_member(text, jsonb) to authenticated, service_role;
grant execute on function public.set_agents_paused(text, text, timestamptz, text[], timestamptz, jsonb) to authenticated, service_role;
