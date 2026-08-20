-- Load meal options from venue_menus when a wedding has a venue_menu_id assigned.
-- This ensures the RSVP form shows the correct meal options for couples who use
-- the venue's menu templates instead of custom meal options.

-- Update wedding_public to load meal options from venue_menus table
create or replace function public.wedding_public(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'wedding', jsonb_set(
      to_jsonb(w) - 'venue_id' - 'rsvp_name_lookup',
      '{meal_options}',
      to_jsonb(coalesce(vm.meal_options, w.meal_options, '{}'::text[]))
    ) || jsonb_build_object(
      'child_meal_options',
      to_jsonb(coalesce(vm.child_meal_options, w.child_meal_options, '{}'::text[]))
    ),
    'venue',   jsonb_build_object('name', v.name, 'logo_url', v.logo_url,
                                  'brand_primary', v.brand_primary, 'website', v.website),
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
  left join public.venue_menus vm on vm.id = w.venue_menu_id
  -- Live sites are public. A draft is visible only to someone who can manage
  -- it, so couples can preview their site before publishing it to guests.
  where w.slug = p_slug
    and (w.status = 'live' or public.can_manage_wedding(w.id));
$$;

-- Update rsvp_lookup to load meal options from venue_menus table
create or replace function public.rsvp_lookup(p_slug text, p_query text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w              public.weddings%rowtype;
  inv            public.invites%rowtype;
  q              text := btrim(coalesce(p_query, ''));
  meal_opts      text[];
  child_meal_opts text[];
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

  -- Get menu options, preferring venue_menus over wedding's own stored options
  if w.venue_menu_id is not null then
    select meal_options, child_meal_options into meal_opts, child_meal_opts
      from public.venue_menus where id = w.venue_menu_id;
  end if;
  meal_opts := coalesce(meal_opts, w.meal_options, '{}'::text[]);
  child_meal_opts := coalesce(child_meal_opts, w.child_meal_options, '{}'::text[]);

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
      'meal_options',       to_jsonb(meal_opts),
      'child_meal_options', to_jsonb(child_meal_opts)
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
