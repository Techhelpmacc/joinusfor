-- public.settings holds the Resend API key. It was created directly in the SQL
-- editor and so never had row level security switched on — RLS is opt-in per
-- table, and install.sql only enables it for the tables it creates itself.
--
-- Everything in the public schema is served by PostgREST, so for several days
-- the key was readable by anyone using the anon key published in config.js.
-- Confirmed by request, fixed 2026-08-21, and the exposed key rotated.
--
-- No policy is wanted here. The email functions that read this table are all
-- security definer, so they see the row with the owner's rights; with RLS on
-- and no policy, no client can read it at all. That is the whole intent.
--
-- Anything added to this table later is a secret by definition. Do not write a
-- policy to make it readable — pass it through a security definer function.

alter table public.settings enable row level security;
