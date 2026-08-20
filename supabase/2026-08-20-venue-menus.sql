-- Venue menu templates: reusable meal menus per venue
-- Venues create Gold/Silver/Bronze menus once, then assign to weddings

create table if not exists public.venue_menus (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  name          text not null,
  meal_options         text[] not null default '{}',
  child_meal_options   text[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (venue_id, name)
);
create index if not exists venue_menus_venue_idx on public.venue_menus(venue_id);

-- Add menu reference to weddings
alter table public.weddings add column if not exists venue_menu_id uuid references public.venue_menus(id) on delete set null;

-- Row-level security
alter table public.venue_menus enable row level security;

create policy venue_menus_read on public.venue_menus for select
  using (public.can_manage_venue(venue_id) or public.is_owner());

create policy venue_menus_write on public.venue_menus for all
  using (public.can_manage_venue(venue_id) or public.is_owner())
  with check (public.can_manage_venue(venue_id) or public.is_owner());
