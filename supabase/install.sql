-- ============================================================================
--  WEDDING HUB — full database install
--  Paste into Supabase → SQL Editor → Run. Safe to re-run (idempotent).
--
--  Tenancy model: platform (you) → venues → weddings → invites → guests
--  Guest lists are NEVER publicly readable. Guests reach their own row only
--  through the rsvp_lookup() function, which returns one household at a time.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- TABLES ---

create table if not exists public.venues (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  contact_email text,
  logo_url      text,
  brand_primary text not null default '#8a6f4e',
  website       text,
  created_at    timestamptz not null default now()
);

create table if not exists public.weddings (
  id                   uuid primary key default gen_random_uuid(),
  venue_id             uuid not null references public.venues(id) on delete cascade,
  slug                 text unique not null,
  partner_a            text not null,
  partner_b            text not null,
  wedding_date         date not null,
  ceremony_time        text,
  location_name        text,
  location_address     text,
  location_maps_url    text,
  hero_image_url       text,
  intro                text,
  story                text,
  theme                text not null default 'ivory-sage',
  status               text not null default 'draft'
                       check (status in ('draft','live','archived')),
  rsvp_deadline        date,
  rsvp_open            boolean not null default true,
  rsvp_name_lookup     boolean not null default true,
  meal_options         text[]  not null default '{}',
  -- Separate menu for children. Empty means children get the adult list.
  child_meal_options   text[]  not null default '{}',
  guest_upload_enabled boolean not null default false,
  gallery_visible      boolean not null default false,
  -- Tier 3 hosting: the couple's own domain, e.g. johnandamyswedding.com.
  -- Left null for path (/w/slug) and subdomain weddings.
  custom_domain        text unique,
  -- Set by the couple once the day is over. The site then drops the RSVP,
  -- timings and practical details and becomes a thank-you plus the album.
  -- Deliberately a manual switch, not the date: some couples want the running
  -- order up for days afterwards, others flip it the same evening.
  wedding_complete     boolean not null default false,
  closing_message      text,
  created_at           timestamptz not null default now()
);
create index if not exists weddings_venue_idx on public.weddings(venue_id);

-- Added after first release; keeps existing installs upgradable.
alter table public.weddings add column if not exists custom_domain text;
alter table public.weddings add column if not exists child_meal_options text[] not null default '{}';
alter table public.weddings add column if not exists wedding_complete boolean not null default false;
alter table public.weddings add column if not exists closing_message text;
do $$ begin
  alter table public.weddings add constraint weddings_custom_domain_key unique (custom_domain);
exception when duplicate_table or duplicate_object then null; end $$;

create table if not exists public.schedule_items (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references public.weddings(id) on delete cascade,
  time_label  text not null,
  title       text not null,
  description text,
  sort_order  int  not null default 0
);
create index if not exists schedule_wedding_idx on public.schedule_items(wedding_id);

create table if not exists public.info_blocks (
  id         uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  title      text not null,
  body       text not null,
  link_url   text,
  link_label text,
  sort_order int  not null default 0
);
create index if not exists info_wedding_idx on public.info_blocks(wedding_id);

-- One row per household / envelope. invite_code is what goes on the card.
create table if not exists public.invites (
  id             uuid primary key default gen_random_uuid(),
  wedding_id     uuid not null references public.weddings(id) on delete cascade,
  household_name text not null,
  invite_code    text not null,
  email          text,
  phone          text,
  invited_to     text not null default 'all'
                 check (invited_to in ('all','ceremony','reception','evening')),
  notes          text,
  responded_at   timestamptz,
  message        text,
  song_request   text,
  created_at     timestamptz not null default now(),
  unique (wedding_id, invite_code)
);
create index if not exists invites_wedding_idx on public.invites(wedding_id);

create table if not exists public.guests (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.invites(id) on delete cascade,
  wedding_id  uuid not null references public.weddings(id) on delete cascade,
  full_name   text not null,
  is_child    boolean not null default false,
  is_plus_one boolean not null default false,
  rsvp_status text not null default 'pending'
              check (rsvp_status in ('pending','attending','declined')),
  meal_choice text,
  dietary     text,
  updated_at  timestamptz not null default now()
);
create index if not exists guests_wedding_idx on public.guests(wedding_id);
create index if not exists guests_invite_idx  on public.guests(invite_id);

create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references public.weddings(id) on delete cascade,
  storage_path  text not null,
  uploader_type text not null default 'guest'
                check (uploader_type in ('couple','venue','guest')),
  uploader_name text,
  caption       text,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists photos_wedding_idx on public.photos(wedding_id, status);

-- Who can administer what. role: owner = you (platform), venue, couple.
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','venue','couple')),
  venue_id   uuid references public.venues(id)   on delete cascade,
  wedding_id uuid references public.weddings(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists memberships_user_idx on public.memberships(user_id);

-- ------------------------------------------------------- HELPER FUNCTIONS ---

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.can_manage_venue(v uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.venue_id = v
  );
$$;

-- Couple can manage their own wedding; venue staff can manage every wedding
-- at their venue; you can manage everything.
create or replace function public.can_manage_wedding(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (select 1 from public.memberships m
                 where m.user_id = auth.uid() and m.wedding_id = w)
      or exists (select 1 from public.memberships m
                 join public.weddings wd on wd.venue_id = m.venue_id
                 where m.user_id = auth.uid() and wd.id = w);
$$;

create or replace function public.wedding_is_public(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.weddings wd
                 where wd.id = w and wd.status = 'live');
$$;

-- ------------------------------------------------------------------- RLS ---

alter table public.venues         enable row level security;
alter table public.weddings       enable row level security;
alter table public.schedule_items enable row level security;
alter table public.info_blocks    enable row level security;
alter table public.invites        enable row level security;
alter table public.guests         enable row level security;
alter table public.photos         enable row level security;
alter table public.memberships    enable row level security;

do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('venues','weddings','schedule_items','info_blocks',
                               'invites','guests','photos','memberships')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Venues: readable by anyone (branding on the guest site), managed by staff.
create policy venues_read   on public.venues for select using (true);
create policy venues_write  on public.venues for all
  using (public.can_manage_venue(id)) with check (public.can_manage_venue(id));

-- Weddings: only 'live' ones are public.
--
-- These two deliberately do NOT call can_manage_wedding(). That helper looks
-- the wedding up in this same table, which finds nothing for a row that is
-- still being inserted — so creating a draft always failed. Checking the
-- membership against the row's own columns works for new and existing rows.
create policy weddings_read_public on public.weddings for select
  using (
    status = 'live'
    or public.is_owner()
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and (m.wedding_id = weddings.id or m.venue_id = weddings.venue_id))
  );
create policy weddings_write on public.weddings for all
  using (
    public.is_owner()
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and (m.wedding_id = weddings.id or m.venue_id = weddings.venue_id))
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.venue_id = weddings.venue_id)
  );

-- Couples may edit their content, but publishing is the venue's call. Hiding
-- the panel in the UI isn't enough — enforce it here too.
create or replace function public.guard_wedding_publishing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No JWT (SQL editor, service role) or platform owner: unrestricted.
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  -- Venue staff may change anything at their own venue.
  if exists (select 1 from public.memberships m
             where m.user_id = auth.uid() and m.venue_id = new.venue_id) then
    return new;
  end if;

  if new.status        is distinct from old.status
  or new.slug          is distinct from old.slug
  or new.custom_domain is distinct from old.custom_domain
  or new.venue_id      is distinct from old.venue_id then
    raise exception 'Publishing settings can only be changed by the venue';
  end if;

  return new;
end $$;

drop trigger if exists guard_wedding_publishing on public.weddings;
create trigger guard_wedding_publishing
  before update on public.weddings
  for each row execute function public.guard_wedding_publishing();

create policy schedule_read on public.schedule_items for select
  using (public.wedding_is_public(wedding_id) or public.can_manage_wedding(wedding_id));
create policy schedule_write on public.schedule_items for all
  using (public.can_manage_wedding(wedding_id))
  with check (public.can_manage_wedding(wedding_id));

create policy info_read on public.info_blocks for select
  using (public.wedding_is_public(wedding_id) or public.can_manage_wedding(wedding_id));
create policy info_write on public.info_blocks for all
  using (public.can_manage_wedding(wedding_id))
  with check (public.can_manage_wedding(wedding_id));

-- Guest list: NO public read. Guests reach their household via rsvp_lookup().
create policy invites_admin on public.invites for all
  using (public.can_manage_wedding(wedding_id))
  with check (public.can_manage_wedding(wedding_id));
create policy guests_admin on public.guests for all
  using (public.can_manage_wedding(wedding_id))
  with check (public.can_manage_wedding(wedding_id));

-- Photos: approved photos of a live wedding with the gallery switched on.
create policy photos_read on public.photos for select
  using (
    (status = 'approved' and exists (
        select 1 from public.weddings w
        where w.id = wedding_id and w.status = 'live' and w.gallery_visible))
    or public.can_manage_wedding(wedding_id)
  );
create policy photos_write on public.photos for all
  using (public.can_manage_wedding(wedding_id))
  with check (public.can_manage_wedding(wedding_id));

create policy memberships_self on public.memberships for select
  using (user_id = auth.uid() or public.is_owner());
create policy memberships_owner on public.memberships for all
  using (public.is_owner()) with check (public.is_owner());

-- ------------------------------------------------------------ GUEST RPCs ---

-- Look up ONE household by invite code, or by guest name if the couple allows.
-- Returns null when nothing matches — never an error, never a list.
create or replace function public.rsvp_lookup(p_slug text, p_query text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w        public.weddings%rowtype;
  inv      public.invites%rowtype;
  q        text := btrim(coalesce(p_query, ''));
begin
  if length(q) < 3 then return null; end if;

  select * into w from public.weddings
   where slug = p_slug and status = 'live';
  if not found then return null; end if;

  -- 1. exact invite code (case/space insensitive)
  select * into inv from public.invites
   where wedding_id = w.id
     and upper(replace(invite_code, ' ', '')) = upper(replace(q, ' ', ''))
   limit 1;

  -- 2. full guest name, only if enabled and unambiguous
  if not found and w.rsvp_name_lookup then
    select i.* into inv
      from public.invites i
      join public.guests g on g.invite_id = i.id
     where i.wedding_id = w.id
       and lower(btrim(g.full_name)) = lower(q)
     limit 1;
  end if;

  if inv.id is null then return null; end if;

  return jsonb_build_object(
    'invite', jsonb_build_object(
      'id',             inv.id,
      'token',          inv.invite_code,
      'household_name', inv.household_name,
      'invited_to',     inv.invited_to,
      'responded_at',   inv.responded_at,
      'message',        inv.message,
      'song_request',   inv.song_request
    ),
    'wedding', jsonb_build_object(
      'rsvp_open',          w.rsvp_open,
      'deadline',           w.rsvp_deadline,
      'meal_options',       to_jsonb(w.meal_options),
      'child_meal_options', to_jsonb(w.child_meal_options)
    ),
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'full_name', g.full_name, 'is_child', g.is_child,
               'is_plus_one', g.is_plus_one, 'rsvp_status', g.rsvp_status,
               'meal_choice', g.meal_choice, 'dietary', g.dietary)
             -- Family first, unnamed plus-one last: an empty name box sitting
             -- between parents and their own children reads badly.
             order by g.is_plus_one, g.is_child, g.full_name)
      from public.guests g where g.invite_id = inv.id), '[]'::jsonb)
  );
end $$;

-- Save a household's response. p_token must match the invite code, so a
-- stolen invite id alone is not enough to write.
create or replace function public.rsvp_submit(
  p_slug text, p_token text, p_guests jsonb,
  p_message text default null, p_song text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  w   public.weddings%rowtype;
  inv public.invites%rowtype;
  rec jsonb;
  n   int := 0;
begin
  select * into w from public.weddings where slug = p_slug and status = 'live';
  if not found then raise exception 'Wedding not found'; end if;
  if not w.rsvp_open then raise exception 'RSVPs are closed'; end if;
  if w.rsvp_deadline is not null and w.rsvp_deadline < current_date then
    raise exception 'The RSVP deadline has passed';
  end if;

  select * into inv from public.invites
   where wedding_id = w.id
     and upper(replace(invite_code, ' ', '')) = upper(replace(btrim(p_token), ' ', ''))
   limit 1;
  if not found then raise exception 'Invitation not recognised'; end if;

  for rec in select * from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb))
  loop
    update public.guests g
       set rsvp_status = coalesce(rec->>'rsvp_status', g.rsvp_status),
           meal_choice = nullif(btrim(coalesce(rec->>'meal_choice','')), ''),
           dietary     = nullif(btrim(coalesce(rec->>'dietary','')), ''),
           full_name   = case
                           when g.is_plus_one
                            and nullif(btrim(coalesce(rec->>'full_name','')),'') is not null
                           then btrim(rec->>'full_name') else g.full_name end,
           updated_at  = now()
     where g.id = (rec->>'id')::uuid
       and g.invite_id = inv.id
       and coalesce(rec->>'rsvp_status','pending') in ('pending','attending','declined');
    n := n + 1;
  end loop;

  update public.invites
     set responded_at = now(),
         message      = nullif(btrim(coalesce(p_message,'')), ''),
         song_request = nullif(btrim(coalesce(p_song,'')), '')
   where id = inv.id;

  return jsonb_build_object('ok', true, 'updated', n);
end $$;

-- Register a guest photo after the file has landed in storage. Always pending.
create or replace function public.guest_photo_submit(
  p_slug text, p_path text, p_name text default null, p_caption text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare w public.weddings%rowtype;
begin
  select * into w from public.weddings where slug = p_slug and status = 'live';
  if not found then raise exception 'Wedding not found'; end if;
  if not w.guest_upload_enabled then raise exception 'Guest uploads are closed'; end if;
  if p_path is null or p_path !~ ('^guest/' || w.id::text || '/') then
    raise exception 'Invalid upload path';
  end if;

  insert into public.photos (wedding_id, storage_path, uploader_type,
                             uploader_name, caption, status)
  values (w.id, p_path, 'guest',
          nullif(btrim(coalesce(p_name,'')), ''),
          nullif(btrim(coalesce(p_caption,'')), ''), 'pending');

  return jsonb_build_object('ok', true);
end $$;

-- Public snapshot of a wedding for the guest site (avoids leaking drafts).
create or replace function public.wedding_public(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'wedding', to_jsonb(w) - 'venue_id' - 'rsvp_name_lookup',
    'venue',   jsonb_build_object('name', v.name, 'logo_url', v.logo_url,
                                  'brand_primary', v.brand_primary, 'website', v.website,
                                  'phone', v.phone, 'address', v.address,
                                  'parking_info', v.parking_info, 'location_maps_url', v.location_maps_url),
    'schedule', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order)
                          from public.schedule_items s where s.wedding_id = w.id), '[]'::jsonb),
    'info',     coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
                          from public.info_blocks i where i.wedding_id = w.id), '[]'::jsonb),
    'rsvp_summary', (select jsonb_build_object(
                       'attending', count(*) filter (where rsvp_status = 'attending'))
                     from public.guests where wedding_id = w.id)
  )
  from public.weddings w
  join public.venues v on v.id = w.venue_id
  -- Live sites are public. A draft is visible only to someone who can manage
  -- it, so couples can preview their site before publishing it to guests.
  where w.slug = p_slug
    and (w.status = 'live' or public.can_manage_wedding(w.id));
$$;

-- ------------------------------------------------------- ACCESS GRANTING ---
-- Venue staff need to link a couple's login to their wedding, which means
-- reading auth.users — only possible inside a security-definer function.

create unique index if not exists memberships_user_wedding_uniq
  on public.memberships(user_id, wedding_id) where wedding_id is not null;

-- A couple can be invited before they have an account. The invitation waits
-- here and is converted to a real membership the moment they first sign in.
create table if not exists public.wedding_invitations (
  id         uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  email      text not null,
  role       text not null default 'couple' check (role in ('couple','venue')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (wedding_id, email)
);
alter table public.wedding_invitations enable row level security;

drop policy if exists wedding_invitations_manage on public.wedding_invitations;
create policy wedding_invitations_manage on public.wedding_invitations for all
  using (public.can_manage_wedding(wedding_id))
  with check (public.can_manage_wedding(wedding_id));

create or replace function public.list_wedding_access(p_wedding uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.can_manage_wedding(p_wedding) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'email')
    from (
      select jsonb_build_object('id', m.id, 'email', u.email,
                                'role', m.role, 'pending', false) as x
        from public.memberships m
        join auth.users u on u.id = m.user_id
       where m.wedding_id = p_wedding
      union all
      select jsonb_build_object('id', wi.id, 'email', wi.email,
                                'role', wi.role, 'pending', true)
        from public.wedding_invitations wi
       where wi.wedding_id = p_wedding
    ) t), '[]'::jsonb);
end $$;

-- Invite by email whether or not they already have an account.
create or replace function public.invite_couple(p_wedding uuid, p_email text)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  w   public.weddings%rowtype;
  uid uuid;
  e   text := lower(btrim(coalesce(p_email, '')));
begin
  select * into w from public.weddings where id = p_wedding;
  if not found then raise exception 'Wedding not found'; end if;
  if not public.can_manage_venue(w.venue_id) then raise exception 'Not allowed'; end if;
  if e = '' or e not like '%@%.%' then raise exception 'Enter a valid email address'; end if;

  select id into uid from auth.users where lower(email) = e limit 1;

  if uid is not null then
    insert into public.memberships (user_id, role, wedding_id)
    values (uid, 'couple', p_wedding)
    on conflict (user_id, wedding_id) do nothing;
    return jsonb_build_object('ok', true, 'existing', true);
  end if;

  insert into public.wedding_invitations (wedding_id, email, role, invited_by)
  values (p_wedding, e, 'couple', auth.uid())
  on conflict (wedding_id, email) do nothing;

  return jsonb_build_object('ok', true, 'existing', false);
end $$;

-- Fires when anyone signs up: turns any waiting invitation into real access.
create or replace function public.claim_wedding_invitations()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (user_id, role, wedding_id)
  select new.id, wi.role, wi.wedding_id
    from public.wedding_invitations wi
   where lower(wi.email) = lower(new.email)
  on conflict (user_id, wedding_id) do nothing;

  delete from public.wedding_invitations where lower(email) = lower(new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.claim_wedding_invitations();

create or replace function public.grant_wedding_access(p_wedding uuid, p_email text)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare uid uuid; w public.weddings%rowtype;
begin
  select * into w from public.weddings where id = p_wedding;
  if not found then raise exception 'Wedding not found'; end if;
  if not public.can_manage_venue(w.venue_id) then raise exception 'Not allowed'; end if;

  select id into uid from auth.users
   where lower(email) = lower(btrim(p_email)) limit 1;

  if uid is null then
    return jsonb_build_object('ok', false, 'error',
      'No account with that email yet. Ask them to sign in once, then try again.');
  end if;

  insert into public.memberships (user_id, role, wedding_id)
  values (uid, 'couple', p_wedding)
  on conflict (user_id, wedding_id) do nothing;

  return jsonb_build_object('ok', true);
end $$;

-- Removes either a granted membership or a still-pending invitation.
create or replace function public.revoke_wedding_access(p_membership uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare w_id uuid; w public.weddings%rowtype;
begin
  select wedding_id into w_id from public.memberships where id = p_membership;
  if w_id is null then
    select wedding_id into w_id from public.wedding_invitations where id = p_membership;
  end if;
  if w_id is null then return jsonb_build_object('ok', true); end if;

  select * into w from public.weddings where id = w_id;
  if w.id is null or not public.can_manage_venue(w.venue_id) then
    raise exception 'Not allowed';
  end if;

  delete from public.memberships        where id = p_membership;
  delete from public.wedding_invitations where id = p_membership;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.list_wedding_access(uuid)         from public;
revoke all on function public.grant_wedding_access(uuid,text)   from public;
revoke all on function public.revoke_wedding_access(uuid)       from public;
revoke all on function public.invite_couple(uuid,text)          from public;
grant execute on function public.list_wedding_access(uuid)        to authenticated;
grant execute on function public.grant_wedding_access(uuid,text)  to authenticated;
grant execute on function public.revoke_wedding_access(uuid)      to authenticated;
grant execute on function public.invite_couple(uuid,text)         to authenticated;

-- Map an incoming hostname to a wedding slug, so johnandamyswedding.com and
-- johnandamy.oakwoodmanor.co.uk both land on the right site. Strips www.
create or replace function public.resolve_host(p_host text)
returns text
language sql stable security definer set search_path = public as $$
  select w.slug
    from public.weddings w
   where w.status = 'live'
     and w.custom_domain is not null
     and lower(regexp_replace(btrim(w.custom_domain), '^www\.', ''))
       = lower(regexp_replace(btrim(coalesce(p_host, '')), '^www\.', ''))
   limit 1;
$$;

-- Look up an invite by code across all live weddings (for guest signup page)
create or replace function public.guest_lookup_by_code(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', inv.id,
    'wedding_id', inv.wedding_id,
    'household_name', inv.household_name,
    'invite_code', inv.invite_code
  )
  from public.invites inv
  join public.weddings w on w.id = inv.wedding_id
  where w.status = 'live'
    and upper(replace(inv.invite_code, ' ', '')) = upper(replace(btrim(coalesce(p_code, '')), ' ', ''))
  limit 1;
$$;

revoke all on function public.resolve_host(text)                       from public;
grant execute on function public.resolve_host(text)                      to anon, authenticated;
revoke all on function public.rsvp_lookup(text,text)                   from public;
revoke all on function public.rsvp_submit(text,text,jsonb,text,text)   from public;
revoke all on function public.guest_photo_submit(text,text,text,text)  from public;
revoke all on function public.wedding_public(text)                     from public;
revoke all on function public.guest_lookup_by_code(text)               from public;
grant execute on function public.rsvp_lookup(text,text)                  to anon, authenticated;
grant execute on function public.rsvp_submit(text,text,jsonb,text,text)  to anon, authenticated;
grant execute on function public.guest_photo_submit(text,text,text,text) to anon, authenticated;
grant execute on function public.wedding_public(text)                    to anon, authenticated;
grant execute on function public.guest_lookup_by_code(text)              to anon, authenticated;

-- --------------------------------------------------------------- STORAGE ---
-- Paths: official/<wedding_id>/<file>   guest/<wedding_id>/<file>

insert into storage.buckets (id, name, public, file_size_limit)
values ('wedding-photos', 'wedding-photos', true, 15728640)
on conflict (id) do update set public = true, file_size_limit = 15728640;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'wh_%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy wh_read on storage.objects for select
  using (bucket_id = 'wedding-photos');

-- Anyone may drop a file into guest/<id>/ while that wedding has uploads open.
create policy wh_guest_insert on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'wedding-photos'
    and (storage.foldername(name))[1] = 'guest'
    and exists (
      select 1 from public.weddings w
      where w.id::text = (storage.foldername(name))[2]
        and w.status = 'live' and w.guest_upload_enabled)
  );

create policy wh_admin_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'wedding-photos'
    and public.can_manage_wedding(((storage.foldername(name))[2])::uuid)
  );

create policy wh_admin_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'wedding-photos'
    and public.can_manage_wedding(((storage.foldername(name))[2])::uuid)
  );
