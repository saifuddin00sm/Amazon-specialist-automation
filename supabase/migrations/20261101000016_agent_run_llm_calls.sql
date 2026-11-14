-- The LLM gateway (packages/llm) logs every model call an agent run makes, with its prompt version,
-- model, tokens and cost (LlmCall[] in packages/core). Calls hold no prompt or output text: those
-- carry seller data. A column on agent_runs, like steps, so the row-level security policies on
-- agent_runs cover it as they are; null for runs that logged none.
alter table public.agent_runs
  add column llm_calls jsonb check (llm_calls is null or jsonb_typeof(llm_calls) = 'array');

-- Appends calls to a running run as the gateway logs them. Secret key only: models are called from
-- the backend, and members can't rewrite what a run cost. Returns false, writing nothing, when the
-- run doesn't exist or has finished.
create function public.append_agent_run_llm_calls(p_run_id text, p_calls jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
begin
  update public.agent_runs
  set llm_calls = coalesce(llm_calls, '[]'::jsonb) || p_calls
  where id = p_run_id and status = 'running';
  return found;
end
$$;

revoke all on function public.append_agent_run_llm_calls(text, jsonb) from public, anon, authenticated;
grant execute on function public.append_agent_run_llm_calls(text, jsonb) to service_role;
