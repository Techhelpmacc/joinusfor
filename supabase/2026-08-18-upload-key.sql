-- ============================================================================
--  Guest uploads: require a shared key, enforced at the storage layer.
--
--  Before this, /u/<slug> needed nothing at all — anyone who guessed a slug
--  could upload. Nothing reached the public site (everything waits for
--  approval), but a stranger could fill the moderation queue with whatever
--  they liked, and there was no limit on storage abuse.
--
--  One key per wedding, embedded in the table QR code so guests type nothing.
-- ============================================================================

-- Unambiguous alphabet: no O/0, no I/1/L.
create or replace function public.gen_upload_key()
returns text
language sql volatile as $$
  select string_agg(
           substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                  (floor(random() * 31)::int + 1), 1), '')
  from generate_series(1, 6);
$$;

alter table public.weddings add column if not exists upload_key text;
alter table public.weddings add column if not exists max_guest_uploads int not null default 500;

update public.weddings set upload_key = public.gen_upload_key() where upload_key is null;
alter table public.weddings alter column upload_key set default public.gen_upload_key();
alter table public.weddings alter column upload_key set not null;

-- ---------------------------------------------------------------------------
-- The key must never appear in the public wedding payload, or it is not a key.
-- ---------------------------------------------------------------------------
create or replace function public.wedding_public(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'wedding', to_jsonb(w) - 'venue_id' - 'rsvp_name_lookup'
                           - 'upload_key' - 'max_guest_uploads',
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
  where w.slug = p_slug
    and (w.status = 'live' or public.can_manage_wedding(w.id));
$$;

-- ---------------------------------------------------------------------------
-- Does this key open this wedding's upload page?
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

  -- Names and theme are already public on the wedding site, so returning them
  -- for the closed and bad-key screens gives nothing away.
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

-- ---------------------------------------------------------------------------
-- Registering a photo now checks the key is in the path, and caps the album.
-- ---------------------------------------------------------------------------
create or replace function public.guest_photo_submit(
  p_slug text, p_path text, p_name text default null, p_caption text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare w public.weddings%rowtype; n int;
begin
  select * into w from public.weddings where slug = p_slug and status = 'live';
  if not found then raise exception 'Wedding not found'; end if;
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

-- ---------------------------------------------------------------------------
-- Let a manager roll the key if it gets out.
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_upload_key(p_wedding uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare k text;
begin
  if not public.can_manage_wedding(p_wedding) then raise exception 'Not allowed'; end if;
  update public.weddings
     set upload_key = public.gen_upload_key()
   where id = p_wedding
   returning upload_key into k;
  return jsonb_build_object('ok', true, 'key', k);
end $$;

revoke all on function public.upload_check(text,text)      from public;
revoke all on function public.regenerate_upload_key(uuid)  from public;
grant execute on function public.upload_check(text,text)     to anon, authenticated;
grant execute on function public.regenerate_upload_key(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: the key must appear in the path. This is the real enforcement —
-- a UI check alone is bypassed by posting straight at storage.
-- Path shape: guest/<wedding_id>/<upload_key>/<file>
-- ---------------------------------------------------------------------------
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
        and upper(w.upload_key) = upper((storage.foldername(name))[3]))
  );

-- The keys, so they can be printed on the QR cards.
select slug, partner_a, partner_b, upload_key, max_guest_uploads
from public.weddings order by wedding_date desc;
