-- Inviting someone who already has an account.
--
-- The invite flow assumed every venue staffer was new to the platform. Anyone
-- who already had a login — a former couple, a manager at another venue, or
-- simply someone invited twice — could not get in: the setup page asked them
-- to choose a password, then tried to sign them in with it, and failed against
-- the password already on the account.
--
-- An existing account does not need an invite at all. It needs a membership.

-- venue_invite_activate already relies on this, so the database has one even
-- though install.sql never declared it. Stated here so a rebuild matches.
create unique index if not exists memberships_user_venue_uniq
  on public.memberships(user_id, venue_id) where venue_id is not null;

-- Link an existing account to a venue, or report that there isn't one so the
-- caller can fall back to sending an invite.
--
-- Owner-only: this reveals whether an address has an account, which is fine
-- behind the owner role but would be an enumeration hole on a public form.
create or replace function public.add_existing_user_to_venue(
  p_venue_id uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from public.memberships
                  where user_id = auth.uid() and role = 'owner') then
    return jsonb_build_object('error', 'Only platform owner can add staff');
  end if;

  -- Addresses are compared case-insensitively; people capitalise inconsistently
  -- and we do not want two accounts for the same mailbox.
  select id into v_user_id from auth.users
   where lower(email) = lower(trim(p_email))
   limit 1;

  if v_user_id is null then
    return jsonb_build_object('found', false);
  end if;

  insert into public.memberships (user_id, venue_id, role)
    values (v_user_id, p_venue_id, 'venue')
    on conflict (user_id, venue_id) do update set role = 'venue';

  return jsonb_build_object('found', true, 'user_id', v_user_id);
end $$;

-- A null user here used to sail through and mark the invite used while linking
-- nobody, burning the token. Refuse it instead.
create or replace function public.venue_invite_activate(p_token text, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_invite venue_invites;
begin
  if p_user_id is null then
    return jsonb_build_object('error', 'No signed-in user to link');
  end if;

  select * into v_invite from public.venue_invites
   where token = p_token
     and expires_at > now()
     and activated_at is null
   limit 1;

  if v_invite.id is null then
    return jsonb_build_object('error', 'Invalid or expired invite');
  end if;

  insert into public.memberships (user_id, venue_id, role)
    values (p_user_id, v_invite.venue_id, 'venue')
    on conflict (user_id, venue_id) do update set role = 'venue';

  update public.venue_invites
    set activated_at = now(), user_id = p_user_id
    where id = v_invite.id;

  return jsonb_build_object(
    'success', true,
    'email', v_invite.email,
    'venue_id', v_invite.venue_id,
    'user_id', p_user_id
  );
end $$;

revoke all on function public.add_existing_user_to_venue(uuid, text) from public;
grant execute on function public.add_existing_user_to_venue(uuid, text) to authenticated;
