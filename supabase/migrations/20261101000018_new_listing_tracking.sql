-- The newListing workflow, split so nothing waits on an event it could miss: one Inngest function
-- drafts and files, one submits when a member approves, and one updates the listing on each of
-- Amazon's notifications. No new tables.

-- A workflow step's model calls are logged in the same write as the step they name, so a retried
-- step never shows one draft and logs the calls of another. Replaces the steps-only function from
-- 20261101000017. Returns false, writing nothing, when the run doesn't exist or has finished.
drop function public.append_agent_run_steps(text, jsonb);

create function public.append_agent_run_steps(p_run_id text, p_steps jsonb, p_calls jsonb default '[]'::jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
begin
  update public.agent_runs
  set steps = coalesce(steps, '[]'::jsonb) || p_steps,
      llm_calls = case when jsonb_array_length(p_calls) = 0 then llm_calls else coalesce(llm_calls, '[]'::jsonb) || p_calls end
  where id = p_run_id and status = 'running';
  return found;
end
$$;

revoke all on function public.append_agent_run_steps(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.append_agent_run_steps(text, jsonb, jsonb) to service_role;

-- Amazon's notifications name a listing by SKU: find the new listing submitted under it.
create index proposals_listing_sku_idx on public.proposals ((listing_submission ->> 'sku'))
  where listing_submission is not null;
