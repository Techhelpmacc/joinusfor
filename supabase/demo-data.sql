-- ============================================================================
--  DEMO DATA — run after install.sql to get a working wedding you can click
--  through immediately. Safe to delete later (see the teardown at the bottom).
-- ============================================================================

insert into public.venues (slug, name, contact_email, brand_primary, website)
values ('oakwood-manor', 'Oakwood Manor', 'events@example.com', '#63755a', 'https://example.com')
on conflict (slug) do nothing;

insert into public.weddings (
  venue_id, slug, partner_a, partner_b, wedding_date, ceremony_time,
  location_name, location_address, location_maps_url,
  hero_image_url, intro, story, theme, status,
  rsvp_deadline, meal_options, guest_upload_enabled, gallery_visible)
select v.id, 'john-and-amy', 'John', 'Amy',
       (current_date + interval '120 days')::date, '1:00pm',
       'Oakwood Manor', E'Oakwood Lane\nPrestbury\nCheshire SK10 4AA',
       'https://maps.google.com/?q=Prestbury+Cheshire',
       'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=2400&q=70',
       'Together with our families',
       E'We met in the queue for a coffee that neither of us really wanted, on a wet Tuesday in Manchester. John talked for eleven minutes about a bridge he was designing. Amy stayed anyway.\n\nSeven years, two cities and one very opinionated cat later, we would love you to come and watch us do this properly.',
       'ivory-sage', 'live',
       (current_date + interval '75 days')::date,
       array['Beef', 'Salmon', 'Wild mushroom risotto'],
       true, false
from public.venues v where v.slug = 'oakwood-manor'
on conflict (slug) do nothing;

-- Timings ------------------------------------------------------------------
insert into public.schedule_items (wedding_id, time_label, title, description, sort_order)
select w.id, x.t, x.ti, x.d, x.s from public.weddings w,
(values
  ('12:30pm', 'Guests arrive', 'Come through to the walled garden — there will be something cold to drink.', 1),
  ('1:00pm',  'Ceremony',      'In the orangery. Please be seated by ten to.', 2),
  ('1:45pm',  'Drinks & photographs', 'Lawn, weather permitting. Library if not.', 3),
  ('3:30pm',  'Wedding breakfast', 'Long tables in the great hall.', 4),
  ('6:00pm',  'Evening guests arrive', null, 5),
  ('7:00pm',  'First dance',  'And then the band until late.', 6),
  ('12:00am', 'Carriages',    'Taxis need booking in advance — see the details below.', 7)
) as x(t, ti, d, s)
where w.slug = 'john-and-amy'
  and not exists (select 1 from public.schedule_items s2 where s2.wedding_id = w.id);

-- Information cards --------------------------------------------------------
insert into public.info_blocks (wedding_id, title, body, link_url, link_label, sort_order)
select w.id, x.ti, x.b, x.u, x.l, x.s from public.weddings w,
(values
  ('Where to stay',
   E'We have held rooms at the manor until eight weeks before, quoting "Shaw–Bennett".\n\nThe Bull in the village is a five minute walk and a little kinder on the wallet.',
   'https://example.com/stay', 'See the room list', 1),
  ('Getting there & parking',
   E'Free parking on site — the entrance is the second gate, not the first.\n\nCars can be left overnight and collected before 11am.',
   null, null, 2),
  ('What to wear',
   E'Black tie is welcome but absolutely not expected.\n\nThe ceremony and drinks are outdoors: heels and gravel are old enemies.',
   null, null, 3),
  ('Gifts',
   E'Your being there is genuinely the thing we want.\n\nIf you would like to give something, we are putting together a fund for the honeymoon.',
   'https://example.com/gifts', 'Honeymoon fund', 4)
) as x(ti, b, u, l, s)
where w.slug = 'john-and-amy'
  and not exists (select 1 from public.info_blocks i2 where i2.wedding_id = w.id);

-- Guest list ---------------------------------------------------------------
do $$
declare
  w_id uuid;
  inv_id uuid;
  r record;
begin
  select id into w_id from public.weddings where slug = 'john-and-amy';
  if w_id is null then return; end if;
  if exists (select 1 from public.invites where wedding_id = w_id) then return; end if;

  for r in
    select * from (values
      ('Mr & Mrs Shaw',        'SHAW-4471', 'shaw@example.com',     'all',
       array['David Shaw','Marie Shaw']),
      ('The Bennett family',   'BENN-9023', 'bennett@example.com',  'all',
       array['Paul Bennett','Louise Bennett','Ella Bennett']),
      ('Rachel Okafor',        'OKAF-1180', 'rachel@example.com',   'all',
       array['Rachel Okafor','Guest']),
      ('Tom & Priya Whitfield','WHIT-6652', 'whitfield@example.com','all',
       array['Tom Whitfield','Priya Whitfield']),
      ('Grandma Joan',         'JOAN-0001', null,                   'ceremony',
       array['Joan Hargreaves']),
      ('The Fletchers',        'FLET-3390', 'fletch@example.com',   'evening',
       array['Sam Fletcher','Nadia Fletcher'])
    ) as t(household, code, email, invited, names)
  loop
    insert into public.invites (wedding_id, household_name, invite_code, email, invited_to)
    values (w_id, r.household, r.code, r.email, r.invited)
    returning id into inv_id;

    insert into public.guests (wedding_id, invite_id, full_name, is_plus_one, is_child)
    select w_id, inv_id, n,
           lower(n) = 'guest',
           n in ('Ella Bennett')
    from unnest(r.names) as n;
  end loop;

  -- A couple of households have already replied, so the dashboard isn't empty.
  update public.guests set rsvp_status = 'attending', meal_choice = 'Beef'
   where wedding_id = w_id and full_name = 'David Shaw';
  update public.guests set rsvp_status = 'attending', meal_choice = 'Salmon',
                           dietary = 'No shellfish'
   where wedding_id = w_id and full_name = 'Marie Shaw';
  update public.invites set responded_at = now(),
         message = 'Wouldn''t miss it for the world. Congratulations both!',
         song_request = 'Stevie Wonder – Signed, Sealed, Delivered'
   where wedding_id = w_id and invite_code = 'SHAW-4471';

  update public.guests set rsvp_status = 'declined'
   where wedding_id = w_id and full_name in ('Sam Fletcher','Nadia Fletcher');
  update public.invites set responded_at = now(),
         message = 'So sorry — we are away that week. Have a wonderful day.'
   where wedding_id = w_id and invite_code = 'FLET-3390';
end $$;

-- ============================================================================
--  MAKE YOURSELF THE OWNER
--  Sign in once at /admin, then run this with your email address:
--
--    insert into public.memberships (user_id, role)
--    select id, 'owner' from auth.users where email = 'you@example.com'
--    on conflict do nothing;
--
--  To give venue staff access to one venue instead:
--
--    insert into public.memberships (user_id, role, venue_id)
--    select u.id, 'venue', v.id from auth.users u, public.venues v
--    where u.email = 'events@theirvenue.com' and v.slug = 'oakwood-manor';
-- ============================================================================

-- Teardown (removes the demo and everything attached to it):
--   delete from public.venues where slug = 'oakwood-manor';
