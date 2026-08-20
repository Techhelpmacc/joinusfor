-- ============================================================================
--  Fix: "Database error saving new user" when inviting a couple.
--
--  memberships_user_wedding_uniq is a PARTIAL unique index:
--      ... on (user_id, wedding_id) where wedding_id is not null
--
--  Postgres will only infer a partial index for ON CONFLICT if the conflict
--  target repeats the predicate. It did not, so the statement raised — and
--  since one of these runs in an AFTER INSERT trigger on auth.users, the whole
--  signup failed with a generic database error.
--
--  Replaced with NOT EXISTS, which needs no index inference and is clearer.
--  The trigger also now swallows its own failures: a missing membership can be
--  fixed in a minute, an account that cannot be created at all cannot.
-- ============================================================================

create or replace function public.claim_wedding_invitations()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (user_id, role, wedding_id)
  select new.id, wi.role, wi.wedding_id
    from public.wedding_invitations wi
   where lower(wi.email) = lower(new.email)
     and not exists (
       select 1 from public.memberships m
        where m.user_id = new.id
          and m.wedding_id = wi.wedding_id);

  delete from public.wedding_invitations
   where lower(email) = lower(new.email);

  return new;
exception when others then
  -- Never block someone signing up because of this.
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.claim_wedding_invitations();

create or replace function public.invite_couple(p_wedding uuid, p_email text)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  w   public.weddings%rowtype;
  uid uuid;
  e   text := lower(btrim(coalesce(p_email, '')));
begin
  select * into w from public.weddings where id = p_wedding;
  if not found then raise exception 'Wedding not found'; end if;
  if not public.can_manage_venue(w.venue_id) then raise exception 'Not allowed'; end if;
  if e = '' or e not like '%_@_%._%' then raise exception 'Enter a valid email address'; end if;

  select id into uid from auth.users where lower(email) = e limit 1;

  if uid is not null then
    insert into public.memberships (user_id, role, wedding_id)
    select uid, 'couple', p_wedding
     where not exists (
       select 1 from public.memberships m
        where m.user_id = uid and m.wedding_id = p_wedding);
    return jsonb_build_object('ok', true, 'existing', true);
  end if;

  insert into public.wedding_invitations (wedding_id, email, role, invited_by)
  select p_wedding, e, 'couple', auth.uid()
   where not exists (
     select 1 from public.wedding_invitations wi
      where wi.wedding_id = p_wedding and lower(wi.email) = e);

  return jsonb_build_object('ok', true, 'existing', false);
end $$;

revoke all on function public.invite_couple(uuid,text) from public;
grant execute on function public.invite_couple(uuid,text) to authenticated;
