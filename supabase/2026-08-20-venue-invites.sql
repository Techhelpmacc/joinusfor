-- Venue invitations for onboarding venue staff.
-- Tracks invite links sent to venue staff with 3-day expiration.

create table if not exists public.venue_invites (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues(id) on delete cascade,
  email           text not null,
  token           text not null unique,  -- Secure random token for the invite link
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,  -- 3 days from creation
  activated_at    timestamptz,           -- When they set their password
  user_id         uuid references auth.users(id) on delete set null,

  unique(venue_id, email)
);

create index if not exists venue_invites_email_idx on public.venue_invites(email);
create index if not exists venue_invites_token_idx on public.venue_invites(token);
create index if not exists venue_invites_expires_idx on public.venue_invites(expires_at);

-- RPC function to validate and get invite details
create or replace function public.venue_invite_check(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'valid', vi.id is not null and vi.expires_at > now() and vi.activated_at is null,
    'email', vi.email,
    'venue_id', vi.venue_id,
    'venue_name', v.name,
    'message', case
      when vi.id is null then 'Invite not found'
      when vi.activated_at is not null then 'This invite has already been used'
      when vi.expires_at <= now() then 'This invite has expired'
      else 'Invite valid'
    end
  )
  from public.venue_invites vi
  left join public.venues v on v.id = vi.venue_id
  where vi.token = p_token;
$$;

-- RPC function to activate an invite (after user is created client-side)
create or replace function public.venue_invite_activate(p_token text, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_invite venue_invites;
begin
  -- Get the invite
  select * into v_invite from public.venue_invites
   where token = p_token
     and expires_at > now()
     and activated_at is null
   limit 1;

  if v_invite.id is null then
    return jsonb_build_object('error', 'Invalid or expired invite');
  end if;

  -- Link user to venue
  insert into public.memberships (user_id, venue_id, role)
    values (p_user_id, v_invite.venue_id, 'venue')
    on conflict (user_id, venue_id) do update set role = 'venue';

  -- Mark invite as activated
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

-- RPC to create venue invite (owner only)
create or replace function public.create_venue_invite(p_venue_id uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_invite public.venue_invites;
  v_token text;
begin
  -- Verify caller is owner (has at least one venue)
  if not exists (select 1 from public.memberships
                  where user_id = auth.uid() and role = 'owner') then
    return jsonb_build_object('error', 'Only platform owner can create invites');
  end if;

  -- Generate secure random token
  v_token := encode(gen_random_bytes(32), 'hex');

  -- Create invite (will fail if already invited)
  insert into public.venue_invites (venue_id, email, token, expires_at)
    values (p_venue_id, p_email, v_token, now() + interval '3 days')
    returning * into v_invite;

  return jsonb_build_object(
    'success', true,
    'token', v_token,
    'email', p_email,
    'expires_at', v_invite.expires_at
  );
exception when unique_violation then
  return jsonb_build_object('error', 'This email is already invited to this venue');
end $$;

-- RPC to list venues (owner only)
create or replace function public.list_venues_for_owner()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'staff_count', (select count(*) from public.memberships
                     where venue_id = v.id and role = 'venue'),
    'created_at', v.created_at
  ))
  from public.venues v
  where exists (select 1 from public.memberships
                 where user_id = auth.uid() and role = 'owner');
$$;

-- Grant permissions
revoke all on function public.venue_invite_check(text) from public;
revoke all on function public.venue_invite_activate(text, uuid) from public;
revoke all on function public.create_venue_invite(uuid, text) from public;
revoke all on function public.list_venues_for_owner() from public;

grant execute on function public.venue_invite_check(text) to anon, authenticated;
grant execute on function public.venue_invite_activate(text, uuid) to anon, authenticated;
grant execute on function public.create_venue_invite(uuid, text) to authenticated;
grant execute on function public.list_venues_for_owner() to authenticated;
