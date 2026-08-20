-- ============================================================================
--  Enquiries from the couples landing page.
--
--  "Email us" asks a stranger to compose an email, which most will not do.
--  A three-field form captures them instead, sends them the demo immediately,
--  and leaves you a lead you can chase.
-- ============================================================================

create table if not exists public.enquiries (
  id           uuid primary key default gen_random_uuid(),
  names        text not null,
  email        text not null,
  wedding_date date,
  message      text,
  source       text not null default 'couples',
  handled      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists enquiries_created_idx on public.enquiries(created_at desc);

alter table public.enquiries enable row level security;

drop policy if exists enquiries_read   on public.enquiries;
drop policy if exists enquiries_manage on public.enquiries;

-- Only you. Venues and couples have no business seeing your sales pipeline.
create policy enquiries_read on public.enquiries for select
  using (public.is_owner());
create policy enquiries_manage on public.enquiries for all
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Submission goes through a function so the shape is validated and the table
-- itself stays closed to anonymous writes.
-- ---------------------------------------------------------------------------
create or replace function public.submit_enquiry(
  p_names text,
  p_email text,
  p_date  date default null,
  p_message text default null,
  p_source text default 'couples')
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  n text := btrim(coalesce(p_names, ''));
  recent int;
begin
  if length(n) < 2 then
    raise exception 'Please tell us your names';
  end if;
  if e = '' or e not like '%_@_%._%' then
    raise exception 'That email address does not look right';
  end if;

  -- Light throttle: the same address cannot flood the table.
  select count(*) into recent
    from public.enquiries
   where lower(email) = e
     and created_at > now() - interval '10 minutes';
  if recent >= 3 then
    raise exception 'We already have your details — we will be in touch shortly';
  end if;

  insert into public.enquiries (names, email, wedding_date, message, source)
  values (n, e, p_date,
          nullif(btrim(coalesce(p_message, '')), ''),
          coalesce(nullif(btrim(p_source), ''), 'couples'));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.submit_enquiry(text,text,date,text,text) from public;
grant execute on function public.submit_enquiry(text,text,date,text,text) to anon, authenticated;
