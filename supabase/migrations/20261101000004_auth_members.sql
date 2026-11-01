-- Magic-link sign-in: an auth user becomes a member through their email. Signups are off (see
-- config.toml), so only people already invited as members get a user. A user who belongs to two
-- workspaces is linked to both member rows.

create function private.link_members_to_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.members
  set user_id = new.id
  where user_id is null and lower(email) = lower(new.email);
  return new;
end
$$;

create trigger link_members_to_user
  after insert or update of email on auth.users
  for each row execute function private.link_members_to_user();

-- Members invited after the person already has a user are linked right away.
create function private.link_member_to_existing_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    select id into new.user_id from auth.users where lower(email) = lower(new.email);
  end if;
  return new;
end
$$;

create trigger link_member_to_existing_user
  before insert or update of email on public.members
  for each row execute function private.link_member_to_existing_user();

revoke all on function private.link_members_to_user() from public, authenticated;
revoke all on function private.link_member_to_existing_user() from public, authenticated;
