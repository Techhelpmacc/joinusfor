-- Venue details: address, parking, phone, maps link
alter table public.venues add column if not exists address text;
alter table public.venues add column if not exists parking_info text;
alter table public.venues add column if not exists phone text;
alter table public.venues add column if not exists location_maps_url text;
