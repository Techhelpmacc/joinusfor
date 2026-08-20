-- Allow anonymous guests to look up their invite by code
-- Used by the guest signup page

create or replace function public.guest_lookup_by_code(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', inv.id,
    'wedding_id', inv.wedding_id,
    'household_name', inv.household_name,
    'invite_code', inv.invite_code
  )
  from public.invites inv
  join public.weddings w on w.id = inv.wedding_id
  where w.status = 'live'
    and upper(replace(inv.invite_code, ' ', '')) = upper(replace(btrim(coalesce(p_code, '')), ' ', ''))
  limit 1;
$$;

revoke all on function public.guest_lookup_by_code(text) from public;
grant execute on function public.guest_lookup_by_code(text) to anon, authenticated;
