-- ============================================================================
--  Restore the public demo at /w/john-and-amy.
--
--  The sales page links to /w/john-and-amy in three places. That wedding no
--  longer exists — deleted along with whatever venue used to host it — so
--  wedding_public() returns null and the page renders empty.
--
--  It must NOT be a venue's own demo wedding. Those are per-venue drafts that
--  the venue is free to edit; the moment one is edited the public sales
--  example changes with it. This creates a venue of our own to host the
--  showcase, so nothing a client does can reach it.
--
--  Everything else already exists and is keyed on the slug 'john-and-amy':
--  reset_demo() puts it back to pristine, is_demo makes rsvp_submit refuse to
--  write, and the storage policy rejects guest uploads on a demo.
--
--  Safe to run twice.
-- ============================================================================

do $$
declare
  v_venue   uuid;
  v_wedding uuid;
begin
  select id into v_venue from public.venues where slug = 'join-us-for';

  if v_venue is null then
    insert into public.venues (slug, name, contact_email, website)
    values ('join-us-for', 'Join Us For', 'hello@joinusfor.co.uk',
            'https://joinusfor.co.uk')
    returning id into v_venue;
  end if;

  -- Already restored by an earlier run: leave the record alone.
  select id into v_wedding from public.weddings where slug = 'john-and-amy';

  if v_wedding is null then
    -- Inserting the venue fires auto_create_demo_wedding_trigger, which seeds
    -- the full demo content. Call it directly if that trigger did not run.
    select id into v_wedding
      from public.weddings
     where venue_id = v_venue and slug = 'demo-wedding-' || v_venue::text;

    if v_wedding is null then
      v_wedding := public.create_demo_wedding_for_venue(v_venue);
    end if;
  end if;

  update public.weddings
     set slug    = 'john-and-amy',
         status  = 'live',
         is_demo = true,
         -- The per-venue demo leaves these null so each venue's own address
         -- shows through. This one has no real venue behind it, so give it
         -- something to display. Editable in /admin/ afterwards.
         location_name    = coalesce(location_name, 'Ashcombe Hall'),
         location_address = coalesce(location_address,
                                     E'Ashcombe Lane\nRainow\nCheshire')
   where id = v_wedding;
end $$;

-- Pristine state: seeded replies back, stray uploads gone, gallery on.
select public.reset_demo();
