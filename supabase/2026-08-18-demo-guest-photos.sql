-- ============================================================================
--  Show both halves of the album on the demo.
--
--  The gallery splits "From the photographer" from "From our guests", which is
--  a good differentiator — but a demo with only official photographs never
--  shows it. Marking a few of the uploaded photographs as guest shots makes
--  the split visible.
--
--  The reset previously deleted photographs by uploader_type = 'guest', which
--  would have wiped these on the next run. It now deletes by *path* instead:
--  anything under guest/ was uploaded by a visitor, anything under official/
--  was put there deliberately and stays.
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

-- ---------------------------------------------------------------------------
-- Relabel three of the demo photographs as guest shots, with names that match
-- people who are actually on the guest list.
-- ---------------------------------------------------------------------------
with ranked as (
  select id, row_number() over (order by created_at) as rn
    from public.photos
   where wedding_id = (select id from public.weddings where slug = 'john-and-amy')
),
labels(rn, who, cap) as (
  values
    (3,  'Ravi Anand',    'Sneaked this one during the speeches.'),
    (6,  'Sue Barnes',    'The walled garden before everyone arrived.'),
    (9,  'Nadia Fletcher', 'Last dance. Nobody sat down.')
)
update public.photos p
   set uploader_type = 'guest',
       uploader_name = labels.who,
       caption       = labels.cap
  from ranked
  join labels on labels.rn = ranked.rn
 where p.id = ranked.id;

-- Give the photographer's set captions too, so the demo album reads properly.
with ranked as (
  select id, row_number() over (order by created_at) as rn
    from public.photos
   where wedding_id = (select id from public.weddings where slug = 'john-and-amy')
     and uploader_type <> 'guest'
),
labels(rn, cap) as (
  values
    (1, 'Before the ceremony'),
    (2, 'The orangery'),
    (3, 'Confetti on the lawn'),
    (4, 'The wedding breakfast'),
    (5, 'Speeches'),
    (6, 'First dance'),
    (7, 'The band')
)
update public.photos p
   set caption = labels.cap
  from ranked
  join labels on labels.rn = ranked.rn
 where p.id = ranked.id and p.caption is null;

select uploader_type, uploader_name, caption, storage_path
from public.photos
where wedding_id = (select id from public.weddings where slug = 'john-and-amy')
order by uploader_type, created_at;
