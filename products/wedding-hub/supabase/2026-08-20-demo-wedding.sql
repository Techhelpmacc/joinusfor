-- Demo wedding auto-created when a venue is set up.
-- Same demo wedding data for all venues so support can reference it consistently.

create or replace function public.create_demo_wedding_for_venue(p_venue_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_wedding_id uuid;
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

  -- Create couple as guests
  insert into public.guests (wedding_id, full_name, rsvp_status)
    values
      (v_wedding_id, 'Colin', 'attending'),
      (v_wedding_id, 'Amanda', 'attending')
    on conflict do nothing;

  -- Create demo invite for couple
  insert into public.invites (wedding_id, household_name, invite_code, invited_to)
    values (v_wedding_id, 'Colin & Amanda', 'DEMO00', 'all')
    on conflict do nothing;

  -- Create sample guests
  insert into public.guests (wedding_id, full_name, rsvp_status, meal_choice, dietary)
    values
      (v_wedding_id, 'Alice Smith', 'attending', 'Fish', null),
      (v_wedding_id, 'Bob Smith', 'declined', null, null),
      (v_wedding_id, 'Charlie Brown', 'attending', 'Beef', 'Vegetarian'),
      (v_wedding_id, 'Diana Brown', 'pending', null, null)
    on conflict do nothing;

  return v_wedding_id;
end $$;

-- Create demo wedding automatically when venue is created
create or replace function public.auto_create_demo_wedding()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only create demo wedding once per venue
  if not exists (select 1 from public.weddings where venue_id = new.id) then
    perform public.create_demo_wedding_for_venue(new.id);
  end if;
  return new;
end $$;

-- Attach trigger to venues table
drop trigger if exists auto_create_demo_wedding_trigger on public.venues;
create trigger auto_create_demo_wedding_trigger
  after insert on public.venues
  for each row
  execute function auto_create_demo_wedding();

-- Grant execute on demo wedding function
revoke all on function public.create_demo_wedding_for_venue(uuid) from public;
grant execute on function public.create_demo_wedding_for_venue(uuid) to authenticated;
