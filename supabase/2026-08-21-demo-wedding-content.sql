-- A demo wedding worth showing someone.
--
-- The previous version created a bare record: two names, a date, four guests
-- and nothing else. Opened up it looked like a broken site rather than a
-- example of one, which is the opposite of what a venue needs when they are
-- showing a couple what they would be getting.
--
-- This fills in what the original hand-built demo had — hero image, story,
-- timings, information cards, and a guest list with replies already in it so
-- the dashboard has numbers on it.
--
-- Deliberately leaves location_name, location_address and location_maps_url
-- null: those now inherit from the venue, so the demo shows each venue their
-- own address rather than a fictional one, and demonstrates the inheritance.

create or replace function public.create_demo_wedding_for_venue(p_venue_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_wedding_id uuid;
  v_slug text := 'demo-wedding-' || p_venue_id::text;
  v_invite_id uuid;
  r record;
begin
  -- weddings.slug is globally unique, so conflict on that rather than on the
  -- venue: two venues must never collide on 'demo-wedding'.
  insert into public.weddings (
    venue_id, slug, partner_a, partner_b, wedding_date, ceremony_time,
    hero_image_url, intro, story, theme, status,
    rsvp_open, rsvp_deadline, meal_options, child_meal_options,
    guest_upload_enabled, gallery_visible
  ) values (
    p_venue_id, v_slug, 'John', 'Amy',
    (current_date + interval '120 days')::date, '1:00pm',
    'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=2400&q=70',
    'Together with our families',
    E'We met in the queue for a coffee that neither of us really wanted, on a wet Tuesday in Manchester. John talked for eleven minutes about a bridge he was designing. Amy stayed anyway.\n\nSeven years, two cities and one very opinionated cat later, we would love you to come and watch us do this properly.',
    'ivory-sage', 'draft',
    true, (current_date + interval '75 days')::date,
    array['Beef', 'Salmon', 'Wild mushroom risotto'],
    array['Chicken goujons', 'Pasta'],
    true, false
  )
  on conflict (slug) do nothing
  returning id into v_wedding_id;

  -- Already there from an earlier run: leave its contents alone, since the
  -- venue may well have been editing it.
  if v_wedding_id is null then
    select id into v_wedding_id from public.weddings where slug = v_slug;
    return v_wedding_id;
  end if;

  -- Timings ----------------------------------------------------------------
  insert into public.schedule_items (wedding_id, time_label, title, description, sort_order)
  select v_wedding_id, x.t, x.ti, x.d, x.s from (values
    ('12:30pm', 'Guests arrive', 'Come through to the garden — there will be something cold to drink.', 1),
    ('1:00pm',  'Ceremony', 'Please be seated by ten to.', 2),
    ('1:45pm',  'Drinks & photographs', 'Outside, weather permitting.', 3),
    ('3:30pm',  'Wedding breakfast', 'Long tables, and speeches that will not overrun.', 4),
    ('6:00pm',  'Evening guests arrive', null, 5),
    ('7:00pm',  'First dance', 'And then the band until late.', 6),
    ('12:00am', 'Carriages', 'Taxis need booking in advance.', 7)
  ) as x(t, ti, d, s);

  -- Information cards ------------------------------------------------------
  -- No parking or address card here: the venue's own details are added to the
  -- guest site automatically, and duplicating them means two sources to keep
  -- in step.
  insert into public.info_blocks (wedding_id, title, body, link_url, link_label, sort_order)
  select v_wedding_id, x.ti, x.b, x.u, x.l, x.s from (values
    ('Where to stay',
     E'We have held rooms until eight weeks before, quoting "Shaw–Bennett".\n\nThere are also a couple of pubs within walking distance that are kinder on the wallet.',
     null, null, 1),
    ('What to wear',
     E'Black tie is welcome but absolutely not expected.\n\nThe ceremony and drinks are outdoors: heels and gravel are old enemies.',
     null, null, 2),
    ('Children',
     E'Little ones are very welcome. There is a separate menu for them, and a quiet room upstairs for when it all gets a bit much.',
     null, null, 3),
    ('Gifts',
     E'Your being there is genuinely the thing we want.\n\nIf you would like to give something, we are putting together a fund for the honeymoon.',
     null, null, 4)
  ) as x(ti, b, u, l, s);

  -- Guest list -------------------------------------------------------------
  -- guests.invite_id is not null, so every guest has to hang off an invite.
  for r in
    select * from (values
      ('Demo: John & Amy',      'DEMO00',    'all',      array['John','Amy']),
      ('Mr & Mrs Shaw',         'SHAW-4471', 'all',      array['David Shaw','Marie Shaw']),
      ('The Bennett family',    'BENN-9023', 'all',      array['Paul Bennett','Louise Bennett','Ella Bennett']),
      ('Rachel Okafor',         'OKAF-1180', 'all',      array['Rachel Okafor','Guest']),
      ('Tom & Priya Whitfield', 'WHIT-6652', 'all',      array['Tom Whitfield','Priya Whitfield']),
      ('Grandma Joan',          'JOAN-0001', 'ceremony', array['Joan Hargreaves']),
      ('The Fletchers',         'FLET-3390', 'evening',  array['Sam Fletcher','Nadia Fletcher'])
    ) as t(household, code, invited, names)
  loop
    insert into public.invites (wedding_id, household_name, invite_code, invited_to)
      values (v_wedding_id, r.household, r.code, r.invited)
      returning id into v_invite_id;

    insert into public.guests (wedding_id, invite_id, full_name, is_plus_one, is_child)
    select v_wedding_id, v_invite_id, n,
           lower(n) = 'guest',
           n = 'Ella Bennett'
      from unnest(r.names) as n;
  end loop;

  -- Some replies already in, so the dashboard opens with numbers on it rather
  -- than a row of zeroes.
  update public.guests set rsvp_status = 'attending', meal_choice = 'Beef'
   where wedding_id = v_wedding_id and full_name in ('John', 'David Shaw');
  update public.guests set rsvp_status = 'attending', meal_choice = 'Salmon',
                           dietary = 'No shellfish'
   where wedding_id = v_wedding_id and full_name in ('Amy', 'Marie Shaw');
  update public.guests set rsvp_status = 'attending', meal_choice = 'Wild mushroom risotto'
   where wedding_id = v_wedding_id and full_name = 'Rachel Okafor';
  update public.guests set rsvp_status = 'declined'
   where wedding_id = v_wedding_id and full_name in ('Sam Fletcher', 'Nadia Fletcher');

  update public.invites set responded_at = now(),
         message = 'Wouldn''t miss it for the world. Congratulations both!',
         song_request = 'Stevie Wonder – Signed, Sealed, Delivered'
   where wedding_id = v_wedding_id and invite_code = 'SHAW-4471';
  update public.invites set responded_at = now(),
         message = 'So sorry — we are away that week. Have a wonderful day.'
   where wedding_id = v_wedding_id and invite_code = 'FLET-3390';

  return v_wedding_id;
end $$;

revoke all on function public.create_demo_wedding_for_venue(uuid) from public;
grant execute on function public.create_demo_wedding_for_venue(uuid) to authenticated;
