-- Writes that touch more than one row run in one transaction, through these functions. The rules
-- (who may decide what, what the next state is) live in packages/data and are shared with the mock;
-- these only commit the result. They run as the caller (security invoker), so RLS still applies,
-- and take rows as snake_case JSON shaped like the tables.

-- Appends AuditEvents in array order, so `seq` follows the order they happened in.
create function private.append_audit_events(p_events jsonb) returns void
language sql security invoker
set search_path = ''
as $$
  insert into public.audit_events (id, workspace_id, seller_account_id, at, actor, action, entity_type, entity_id, metadata)
  select row.id, row.workspace_id, row.seller_account_id, row.at, row.actor, row.action, row.entity_type, row.entity_id, row.metadata
  from jsonb_array_elements(p_events) with ordinality as event (value, position)
  cross join lateral jsonb_populate_record(null::public.audit_events, event.value) as row
  order by event.position
$$;

-- Approve, reject or snooze: saves the decided proposal if it is still pending, retires the
-- rejected listing draft, and appends the audit events. Returns false when the proposal was no
-- longer pending (someone else decided it first), writing nothing.
create function public.commit_proposal_write(
  p_proposal jsonb,
  p_events jsonb,
  p_retire_listing_version_id text default null
) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_next public.proposals := jsonb_populate_record(null::public.proposals, p_proposal);
begin
  update public.proposals as proposal
  set status = v_next.status,
      diff = v_next.diff,
      original_diff = v_next.original_diff,
      snoozed_until = v_next.snoozed_until,
      decided_by = v_next.decided_by,
      decided_at = v_next.decided_at,
      decision_note = v_next.decision_note
  where proposal.id = v_next.id and proposal.status = 'pending_approval';
  if not found then
    return false;
  end if;

  if p_retire_listing_version_id is not null then
    update public.listing_versions
    set status = 'rejected'
    where id = p_retire_listing_version_id and status = 'proposed';
  end if;

  perform private.append_audit_events(p_events);
  return true;
end
$$;

create function public.start_agent_run(p_run jsonb, p_events jsonb) returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  insert into public.agent_runs select * from jsonb_populate_record(null::public.agent_runs, p_run);
  perform private.append_audit_events(p_events);
end
$$;

-- Finishes a running run and files its output: the proposed ListingVersion, its Review and the
-- pending Proposal. Returns false when the run had already finished, writing nothing.
create function public.file_agent_run_output(
  p_run jsonb,
  p_listing_version jsonb,
  p_review jsonb,
  p_proposal jsonb,
  p_events jsonb
) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_run public.agent_runs := jsonb_populate_record(null::public.agent_runs, p_run);
begin
  update public.agent_runs as run
  set status = v_run.status,
      summary = v_run.summary,
      proposal_ids = v_run.proposal_ids,
      steps = v_run.steps,
      finished_at = v_run.finished_at,
      error = v_run.error
  where run.id = v_run.id and run.status = 'running';
  if not found then
    return false;
  end if;

  insert into public.listing_versions
  select * from jsonb_populate_record(null::public.listing_versions, p_listing_version);
  insert into public.reviews select * from jsonb_populate_record(null::public.reviews, p_review);
  insert into public.proposals select * from jsonb_populate_record(null::public.proposals, p_proposal);
  perform private.append_audit_events(p_events);
  return true;
end
$$;

revoke all on function private.append_audit_events(jsonb) from public;
grant execute on function private.append_audit_events(jsonb) to authenticated, service_role;

revoke all on function public.commit_proposal_write(jsonb, jsonb, text) from public, anon;
revoke all on function public.start_agent_run(jsonb, jsonb) from public, anon;
revoke all on function public.file_agent_run_output(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.commit_proposal_write(jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.start_agent_run(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.file_agent_run_output(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
