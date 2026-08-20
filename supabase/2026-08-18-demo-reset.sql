-- ============================================================================
--  Demo wedding: keep it pristine, and never let a stranger put a file in
--  your storage.
--
--  Every prospect clicks the same John & Amy. Without this, the first person
--  to RSVP as the Shaws leaves the next one looking at "you have already
--  replied".
--
--  Uploads are switched off entirely on a demo. Approval only controls what is
--  *displayed* — the file itself would still sit in the bucket, reachable by
--  whoever uploaded it. For a link handed to anonymous strangers off a public
--  web page, that is not a risk worth carrying. The demo album is a set of
--  photographs chosen by us instead.
-- ============================================================================

alter table public.weddings add column if not exists is_demo boolean not null default false;

update public.weddings set is_demo = true where slug = 'john-and-amy';

-- ---------------------------------------------------------------------------
-- Upload page: a demo explains itself rather than asking for a code it will
-- never accept.
-- ---------------------------------------------------------------------------
create or replace function public.upload_check(p_slug text, p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.weddings%rowtype;
begin
  select * into w from public.weddings where slug = p_slug and status = 'live';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if w.is_demo then
    return jsonb_build_object('ok', false, 'reason', 'demo',
      'partner_a', w.partner_a, 'partner_b', w.partner_b, 'theme', w.theme);
  end if;

  if not w.guest_upload_enabled then
    return jsonb_build_object('ok', false, 'reason', 'closed',
      'partner_a', w.partner_a, 'partner_b', w.partner_b, 'theme', w.theme);
  end if;

  if upper(btrim(coalesce(p_key, ''))) <> upper(w.upload_key) then
    return jsonb_build_object('ok', false, 'reason', 'bad_key',
      'partner_a', w.partner_a, 'partner_b', w.partner_b, 'theme', w.theme);
  end if;

  return jsonb_build_object('ok', true,
    'wedding_id', w.id, 'key', w.upload_key,
    'partner_a', w.partner_a, 'partner_b', w.partner_b, 'theme', w.theme);
end $$;

-- Belt and braces: even with a valid path, a demo refuses to register a photo.
create or replace function public.guest_photo_submit(
  p_slug text, p_path text, p_name text default null, p_caption text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare w public.weddings%rowtype; n int;
begin
  select * into w from public.weddings where slug = p_slug and status = 'live';
  if not found then raise exception 'Wedding not found'; end if;
  if w.is_demo then raise exception 'This is a demonstration site'; end if;
  if not w.guest_upload_enabled then raise exception 'Guest uploads are closed'; end if;

  if p_path is null
     or p_path !~ ('^guest/' || w.id::text || '/' || w.upload_key || '/[^/]+$') then
    raise exception 'This upload link is not valid';
  end if;

  select count(*) into n
    from public.photos
   where wedding_id = w.id and uploader_type = 'guest';

  if n >= w.max_guest_uploads then
    raise exception 'This album has reached its limit of % guest photographs',
                    w.max_guest_uploads;
  end if;

  insert into public.photos (wedding_id, storage_path, uploader_type,
                             uploader_name, caption, status)
  values (w.id, p_path, 'guest',
          nullif(btrim(coalesce(p_name, '')), ''),
          nullif(btrim(coalesce(p_caption, '')), ''), 'pending');

  return jsonb_build_object('ok', true);
end $$;

-- And at the storage layer, which is the one that actually matters: a demo
-- accepts no files at all, regardless of key.
drop policy if exists wh_guest_insert on storage.objects;
create policy wh_guest_insert on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'wedding-photos'
    and (storage.foldername(name))[1] = 'guest'
    and exists (
      select 1 from public.weddings w
      where w.id::text = (storage.foldername(name))[2]
        and w.status = 'live'
        and w.guest_upload_enabled
        and not w.is_demo
        and upper(w.upload_key) = upper((storage.foldername(name))[3]))
  );

-- ---------------------------------------------------------------------------
-- Put the demo back to how it should look.
-- ---------------------------------------------------------------------------
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

  -- Re-apply the seeded replies so the dashboard is not empty.
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

  -- Anything not put there by you goes. Should be nothing now uploads are off,
  -- but this clears what was uploaded before and covers any future slip.
  delete from public.photos
   where wedding_id = w_id and uploader_type = 'guest';
  get diagnostics photos_removed = row_count;

  update public.weddings
     set gallery_visible = true,
         guest_upload_enabled = false,
         rsvp_open = true,
         is_demo = true
   where id = w_id;

  return jsonb_build_object('ok', true,
    'guests_reset', guests_reset,
    'guest_photos_removed', photos_removed);
end $$;

revoke all on function public.reset_demo() from public;
grant execute on function public.reset_demo() to anon, authenticated;

select public.reset_demo();
