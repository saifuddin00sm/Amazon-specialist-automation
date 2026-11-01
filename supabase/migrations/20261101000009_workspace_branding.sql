-- White-label report branding per workspace: display name, logo and colors, as one JSON object
-- shaped like BrandingSchema in packages/core workspace.ts (Zod validates it on the way in and out).
-- The logo is an image data URL or an https URL, capped well above the app's 150,000 characters.

alter table public.workspaces
  add column branding jsonb check (branding is null or (jsonb_typeof(branding) = 'object' and pg_column_size(branding) < 400000));

-- Owners change it like the workspace name; the "owners rename their workspaces" update policy
-- already limits the rows to workspaces they own.
grant update (branding) on public.workspaces to authenticated;

-- Saves the branding and its settings.updated event together. Returns false when the caller can't
-- update that workspace (it doesn't exist, or RLS hides it), writing nothing.
create function public.update_workspace_branding(p_workspace_id text, p_branding jsonb, p_events jsonb) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
begin
  update public.workspaces set branding = p_branding where id = p_workspace_id;
  if not found then
    return false;
  end if;
  perform private.append_audit_events(p_events);
  return true;
end
$$;

revoke all on function public.update_workspace_branding(text, jsonb, jsonb) from public, anon;
grant execute on function public.update_workspace_branding(text, jsonb, jsonb) to authenticated, service_role;
