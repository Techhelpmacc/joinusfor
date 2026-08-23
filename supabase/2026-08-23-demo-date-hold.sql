-- ============================================================================
--  Stop reset_demo() dragging the demo date back to a 120-day countdown.
--
--  The demo is deliberately parked on 24 June 2028, far enough out that it
--  cannot go stale unattended. reset_demo() ran on every enquiry and set
--  wedding_date to current_date + 120 days unconditionally, so the first lead
--  through the form would have quietly undone that.
--
--  Now the date is only pushed out when it is close enough to matter, which
--  keeps the safety net (the demo can never show a wedding in the past) without
--  overriding a date chosen on purpose.
--
--  Taken from the live definition via pg_get_functiondef, not the repo copy —
--  the two had drifted. Everything else is unchanged.
-- ============================================================================

create or replace function public.reset_demo()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  w_id uuid;
  photos_removed int := 0;
  guests_reset   int := 0;
  w_date         date;
begin
  select id into w_id from public.weddings where slug = 'john-and-amy';
  if w_id is null then
    return jsonb_build_object('ok', false, 'error', 'demo wedding not found');
  end if;

  update public.guests
     set rsvp_status = 'pending',
         meal_choice = null,
         dietary     = null,
         full_name   = case when is_plus_one then 'Guest' else full_name end,
         updated_at  = now()
   where wedding_id = w_id;
  get diagnostics guests_reset = row_count;

  update public.invites
     set responded_at = null, message = null, song_request = null
   where wedding_id = w_id;

  update public.guests set rsvp_status = 'attending', meal_choice = 'Beef'
   where wedding_id = w_id and full_name = 'David Shaw';
  update public.guests set rsvp_status = 'attending', meal_choice = 'Salmon',
                           dietary = 'No shellfish'
   where wedding_id = w_id and full_name = 'Marie Shaw';
  update public.invites
     set responded_at = now(),
         message = 'Wouldn''t miss it for the world. Congratulations both!',
         song_request = 'Stevie Wonder – Signed, Sealed, Delivered'
   where wedding_id = w_id and invite_code = 'SHAW-4471';

  update public.guests set rsvp_status = 'declined'
   where wedding_id = w_id and full_name in ('Sam Fletcher', 'Nadia Fletcher');
  update public.invites
     set responded_at = now(),
         message = 'So sorry — we are away that week. Have a wonderful day.'
   where wedding_id = w_id and invite_code = 'FLET-3390';

  -- Delete by path, not by label: only things a visitor actually uploaded.
  delete from public.photos
   where wedding_id = w_id and storage_path like 'guest/%';
  get diagnostics photos_removed = row_count;

  update public.weddings
     set is_demo              = true,
         status               = 'live',
         -- Only rescue the date when it is near enough to expire. A date set
         -- deliberately far out is left exactly where it was put.
         wedding_date         = case
                                  when wedding_date < current_date + interval '60 days'
                                  then (current_date + interval '120 days')::date
                                  else wedding_date end,
         rsvp_deadline        = case
                                  when wedding_date < current_date + interval '60 days'
                                  then (current_date + interval '75 days')::date
                                  else rsvp_deadline end,
         rsvp_open            = true,
         wedding_complete     = false,
         closing_message      = null,
         gallery_visible      = true,
         guest_upload_enabled = false
   where id = w_id;

  select wedding_date into w_date from public.weddings where id = w_id;

  return jsonb_build_object('ok', true,
    'guests_reset', guests_reset,
    'guest_photos_removed', photos_removed,
    'wedding_date', w_date);
end $function$;
