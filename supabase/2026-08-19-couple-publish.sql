-- Fix: Allow couples to publish their wedding by changing status from draft to live
-- Modify the guard trigger to allow status changes from couples

create or replace function public.guard_wedding_publishing()
returns trigger
language plpgsql as $$
declare
  is_venue_staff boolean;
  is_couple boolean;
begin
  select exists(
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.venue_id = old.venue_id
      and m.role = 'venue'
  ) into is_venue_staff;

  if is_venue_staff then
    return new;
  end if;

  -- Check if user is a couple of this wedding
  select exists(
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.wedding_id = old.id
      and m.role = 'couple'
  ) into is_couple;

  -- Only allow couples to change status from draft to live
  if is_couple
     and new.status is distinct from old.status
     and old.status = 'draft'
     and new.status = 'live'
     and new.slug is not distinct from old.slug
     and new.custom_domain is not distinct from old.custom_domain
     and new.venue_id is not distinct from old.venue_id then
    return new;
  end if;

  -- All other changes require venue staff
  if new.status        is distinct from old.status
  or new.slug          is distinct from old.slug
  or new.custom_domain is distinct from old.custom_domain
  or new.venue_id      is distinct from old.venue_id then
    raise exception 'Publishing settings can only be changed by the venue';
  end if;

  return new;
end $$;
