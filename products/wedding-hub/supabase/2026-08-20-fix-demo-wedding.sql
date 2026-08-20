-- Fix demo wedding creation to include invite_id for guests

create or replace function public.create_demo_wedding_for_venue(p_venue_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_wedding_id uuid;
  v_invite_id uuid;
begin
  -- Create demo wedding
  insert into public.weddings (
    venue_id, partner_a, partner_b, wedding_date, slug, status,
    rsvp_open, rsvp_deadline
  ) values (
    p_venue_id,
    'Colin', 'Amanda',
    '2026-10-09'::date,
    'demo-wedding',
    'live',
    true,
    '2026-10-02'::date
  )
  on conflict (venue_id, slug) do update set
    status = 'live',
    rsvp_open = true
  returning id into v_wedding_id;

  -- Create demo invite for couple
  insert into public.invites (wedding_id, household_name, invite_code, invited_to)
    values (v_wedding_id, 'Colin & Amanda', 'DEMO00', 'all')
    on conflict do nothing
  returning id into v_invite_id;

  -- If no invite was created (conflict), get the existing one
  if v_invite_id is null then
    select id into v_invite_id from public.invites
      where wedding_id = v_wedding_id and household_name = 'Colin & Amanda'
      limit 1;
  end if;

  -- Create couple as guests
  insert into public.guests (wedding_id, invite_id, full_name, rsvp_status)
    values
      (v_wedding_id, v_invite_id, 'Colin', 'attending'),
      (v_wedding_id, v_invite_id, 'Amanda', 'attending')
    on conflict do nothing;

  -- Create sample guests
  insert into public.guests (wedding_id, invite_id, full_name, rsvp_status, meal_choice, dietary)
    values
      (v_wedding_id, v_invite_id, 'Alice Smith', 'attending', 'Fish', null),
      (v_wedding_id, v_invite_id, 'Bob Smith', 'declined', null, null),
      (v_wedding_id, v_invite_id, 'Charlie Brown', 'attending', 'Beef', 'Vegetarian'),
      (v_wedding_id, v_invite_id, 'Diana Brown', 'pending', null, null)
    on conflict do nothing;

  return v_wedding_id;
end $$;
