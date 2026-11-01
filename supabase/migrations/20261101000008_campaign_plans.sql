-- No new tables: a campaign plan is a row in proposals and its run a row in agent_runs, so the
-- existing row-level security policies on both apply as they are.

-- One campaign plan waits for approval per campaign at a time.
create unique index proposals_one_pending_campaign_plan_idx on public.proposals (target_id)
  where type = 'campaign_plan' and status = 'pending_approval';

-- Finishes a running run and files its Proposal, when it made one, with the audit events. For
-- agents whose only output is a Proposal (file_agent_run_output also files a listing draft and its
-- Review). Returns false when the run had already finished, writing nothing.
create function public.finish_agent_run(p_run jsonb, p_events jsonb, p_proposal jsonb default null) returns boolean
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

  if p_proposal is not null then
    insert into public.proposals select * from jsonb_populate_record(null::public.proposals, p_proposal);
  end if;
  perform private.append_audit_events(p_events);
  return true;
end
$$;

revoke all on function public.finish_agent_run(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.finish_agent_run(jsonb, jsonb, jsonb) to authenticated, service_role;
