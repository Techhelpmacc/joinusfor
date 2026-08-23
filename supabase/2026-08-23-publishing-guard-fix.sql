-- ============================================================================
--  Restore the exemptions that couple-publishing dropped.
--
--  2026-08-19-couple-publish.sql rewrote guard_wedding_publishing() to let a
--  couple publish their own wedding, and in doing so lost three things the
--  original in install.sql had:
--
--    * the `auth.uid() is null` escape hatch, so nothing could be fixed from
--      the SQL editor or by the service role;
--    * the is_owner() exemption, so the platform owner could not change a
--      wedding's status or slug at all — only venue staff could;
--    * security definer, so the trigger read memberships as the caller and
--      could miss rows RLS hid from them.
--
--  Found on 2026-08-23 when restoring the public demo: the SQL editor was
--  refused with "Publishing settings can only be changed by the venue".
--  Couple-publishing is kept exactly as it was.
-- ============================================================================

create or replace function public.guard_wedding_publishing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No JWT (SQL editor, service role) or platform owner: unrestricted.
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  -- Venue staff may change anything at their own venue.
  if exists (select 1 from public.memberships m
             where m.user_id = auth.uid() and m.venue_id = new.venue_id) then
    return new;
  end if;

  -- A couple may publish their own wedding — draft to live, nothing else.
  if exists (select 1 from public.memberships m
             where m.user_id = auth.uid()
               and m.wedding_id = old.id and m.role = 'couple')
     and new.status is distinct from old.status
     and old.status = 'draft' and new.status = 'live'
     and new.slug          is not distinct from old.slug
     and new.custom_domain is not distinct from old.custom_domain
     and new.venue_id      is not distinct from old.venue_id then
    return new;
  end if;

  if new.status        is distinct from old.status
  or new.slug          is distinct from old.slug
  or new.custom_domain is distinct from old.custom_domain
  or new.venue_id      is distinct from old.venue_id then
    raise exception 'Publishing settings can only be changed by the venue';
  end if;

  return new;
end $$;
