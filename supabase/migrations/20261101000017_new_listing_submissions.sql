-- New listings reach Amazon. The newListing workflow (packages/workflows) drafts a listing as an
-- Inngest run, files it as a new_listing proposal, and once a member approves it submits it with
-- putListingsItem. Amazon's answer is recorded on the proposal (ListingSubmission in packages/core)
-- and kept up to date from listing notifications until the listing is live.
-- No new tables: the submission is a column on proposals and the run's timeline is agent_runs.steps,
-- so the row-level security policies on both apply as they are. Only the secret key writes either:
-- members get no grant on the new column, and the functions below are the backend's alone.

-- Not used below, so it can share this migration (see 20261101000010).
alter type public.audit_action add value 'proposal.listing_updated';

alter table public.proposals
  add column listing_submission jsonb check (listing_submission is null or jsonb_typeof(listing_submission) = 'object'),
  add constraint listing_submission_once_submitted check (
    listing_submission is null or (type = 'new_listing' and status in ('applied', 'failed'))
  );

-- As in 20261101000014, plus one more update: Amazon's latest word on a submitted new listing, which
-- changes its listing_submission and nothing else. The status pairs are unchanged.
create or replace function private.check_proposal_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status
    and old.status in ('applied', 'failed')
    and to_jsonb(new) - 'listing_submission' = to_jsonb(old) - 'listing_submission' then
    return new;
  end if;
  if (old.status::text, new.status::text) not in (
    ('pending_approval', 'approved'),
    ('pending_approval', 'rejected'),
    ('pending_approval', 'pending_approval'),
    ('pending_approval', 'superseded'),
    ('approved', 'applied'),
    ('approved', 'failed')
  ) then
    raise exception 'A % proposal can''t become %', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.status <> 'pending_approval'
    and (new.diff, new.original_diff, new.decided_by, new.decided_at, new.decision_note)
      is distinct from (old.diff, old.original_diff, old.decided_by, old.decided_at, old.decision_note) then
    raise exception 'A % proposal can''t be edited', old.status using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- Appends steps to a running run as a workflow takes them. Returns false, writing nothing, when the
-- run doesn't exist or has finished.
create function public.append_agent_run_steps(p_run_id text, p_steps jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
begin
  update public.agent_runs
  set steps = coalesce(steps, '[]'::jsonb) || p_steps
  where id = p_run_id and status = 'running';
  return found;
end
$$;

-- Records Amazon's answer for a new listing: an approved proposal becomes applied (accepted) or failed
-- (refused), and an applied one gets Amazon's latest word. Saves only if the status is still one of
-- `p_from`, then appends the audit events. Returns false, writing nothing, otherwise.
create function public.save_listing_submission(p_proposal jsonb, p_from public.proposal_status[], p_events jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_next public.proposals := jsonb_populate_record(null::public.proposals, p_proposal);
begin
  update public.proposals as proposal
  set status = v_next.status,
      applied_at = v_next.applied_at,
      listing_submission = v_next.listing_submission
  where proposal.id = v_next.id and proposal.type = 'new_listing' and proposal.status = any (p_from);
  if not found then
    return false;
  end if;
  perform private.append_audit_events(p_events);
  return true;
end
$$;

revoke all on function public.append_agent_run_steps(text, jsonb) from public, anon, authenticated;
grant execute on function public.append_agent_run_steps(text, jsonb) to service_role;
revoke all on function public.save_listing_submission(jsonb, public.proposal_status[], jsonb) from public, anon, authenticated;
grant execute on function public.save_listing_submission(jsonb, public.proposal_status[], jsonb) to service_role;
