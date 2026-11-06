-- The proposal state machine. Its rules live in packages/core (PROPOSAL_TRANSITIONS); this mirrors
-- them so no client can skip a step through the API, and lets members publish approved proposals.
-- No new tables.

-- Every status change must be one PROPOSAL_TRANSITIONS allows (snooze is the pending -> pending
-- pair), and a decided proposal keeps what was decided: only its status and applied_at move on.
-- schema-drift.test.ts keeps the pairs in step with packages/core.
create function private.check_proposal_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger proposals_check_transition
  before update on public.proposals
  for each row execute function private.check_proposal_transition();

-- Publishing an approved proposal records when it was applied.
grant update (applied_at) on public.proposals to authenticated;

-- Publish an approved proposal, as an actor on its account. The trigger above stops this policy and
-- "actors decide pending proposals" from being combined into a skipped step.
create policy "actors publish approved proposals" on public.proposals
  for update to authenticated
  using (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status = 'approved')
  with check (seller_account_id = any ((select private.actionable_account_ids())::text[]) and status = 'applied');

-- Commits one transition: saves the proposal if its status is still one of `p_from`, retires the
-- rejected listing draft, and appends the audit events. Returns false when the status had changed
-- meanwhile (someone else got there first), writing nothing. Replaces commit_proposal_write.
create function public.commit_proposal_transition(
  p_proposal jsonb,
  p_from public.proposal_status[],
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
      decision_note = v_next.decision_note,
      applied_at = v_next.applied_at
  where proposal.id = v_next.id and proposal.status = any (p_from);
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

revoke all on function public.commit_proposal_transition(jsonb, public.proposal_status[], jsonb, text) from public, anon;
grant execute on function public.commit_proposal_transition(jsonb, public.proposal_status[], jsonb, text)
  to authenticated, service_role;

drop function public.commit_proposal_write(jsonb, jsonb, text);
