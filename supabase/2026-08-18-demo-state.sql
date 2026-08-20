-- ============================================================================
--  The demo must always look like an upcoming wedding.
--
--  A prospect is buying the RSVP and the run-up, so that is what the example
--  has to show. Left to drift it ends up mid-test — marked complete, with a
--  date in the past and no RSVP section at all.
--
--  The date is set relative to today, so the countdown is always sensible and
--  the demo never quietly expires.
-- ============================================================================

create or replace function public.reset_demo()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  w_id uuid;
  photos_removed int := 0;
  guests_reset   int := 0;
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

  -- Two seeded replies, so the dashboard is not empty when you demo it.
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

  delete from public.photos
   where wedding_id = w_id and uploader_type = 'guest';
  get diagnostics photos_removed = row_count;

  update public.weddings
     set is_demo              = true,
         status               = 'live',
         -- Always in the future, so the RSVP shows and the countdown reads well.
         wedding_date         = (current_date + interval '120 days')::date,
         rsvp_deadline        = (current_date + interval '75 days')::date,
         rsvp_open            = true,
         wedding_complete     = false,
         closing_message      = null,
         gallery_visible      = true,
         guest_upload_enabled = false
   where id = w_id;

  return jsonb_build_object('ok', true,
    'guests_reset', guests_reset,
    'guest_photos_removed', photos_removed,
    'wedding_date', (current_date + interval '120 days')::date);
end $$;

revoke all on function public.reset_demo() from public;
grant execute on function public.reset_demo() to anon, authenticated;

select public.reset_demo();
