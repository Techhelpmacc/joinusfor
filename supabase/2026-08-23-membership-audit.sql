-- ============================================================================
--  Who can log in to what — audit and cleanup.
--
--  Nothing in this file runs itself. Paste a block into the Supabase SQL
--  editor. Every SELECT is safe to run at any time. Read its output before
--  running any DELETE: a membership row IS someone's access, and removing the
--  wrong one locks a real client out of their own wedding.
--
--  Why the mess happens: memberships has no uniqueness across roles, and
--  invite_couple() adds a 'couple' row to an account that may already be venue
--  staff. admin.js then resolves any staff row first (isStaff() beats
--  isCoupleOnly()), so an address used for both always lands in the venue view.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Every login and what it can reach. Start here.
-- ---------------------------------------------------------------------------
select u.email,
       m.role,
       coalesce(v.name, vw.name)                         as venue,
       case when w.id is not null
            then w.partner_a || ' & ' || w.partner_b end as wedding,
       m.created_at,
       m.id                                              as membership_id
  from public.memberships m
  join auth.users        u  on u.id  = m.user_id
  left join public.venues   v  on v.id  = m.venue_id
  left join public.weddings w  on w.id  = m.wedding_id
  left join public.venues   vw on vw.id = w.venue_id
 order by u.email, m.created_at;

-- ---------------------------------------------------------------------------
-- 2. Just the accounts wearing more than one hat — the ones causing this.
-- ---------------------------------------------------------------------------
select u.email,
       count(*)                                          as memberships,
       string_agg(distinct m.role, ', ' order by m.role)  as roles
  from public.memberships m
  join auth.users u on u.id = m.user_id
 group by u.email
having count(*) > 1
 order by 2 desc, 1;

-- ---------------------------------------------------------------------------
-- 3. Invitations sent but never claimed. These become memberships the moment
--    someone signs up with that address, so stale ones re-create the problem.
-- ---------------------------------------------------------------------------
select wi.email, wi.role,
       w.partner_a || ' & ' || w.partner_b as wedding,
       wi.created_at
  from public.wedding_invitations wi
  join public.weddings w on w.id = wi.wedding_id
 order by wi.created_at;

select vi.email, v.name as venue, vi.created_at, vi.expires_at, vi.activated_at
  from public.venue_invites vi
  join public.venues v on v.id = vi.venue_id
 order by vi.created_at;

-- ---------------------------------------------------------------------------
-- 4. CLEANUP. Uncomment, set the address, run the SELECT, then the DELETE.
--    Deleting a membership does not delete the login — the account survives
--    and simply stops seeing that venue or wedding.
-- ---------------------------------------------------------------------------

-- 4a. See exactly what would go before removing it.
-- select u.email, m.role, m.venue_id, m.wedding_id, m.id
--   from public.memberships m
--   join auth.users u on u.id = m.user_id
--  where lower(u.email) = lower('test@example.com');

-- 4b. Take the couple hat off a test address, leaving its venue access alone.
-- delete from public.memberships m
--  using auth.users u
--  where u.id = m.user_id
--    and lower(u.email) = lower('test@example.com')
--    and m.role = 'couple';

-- 4c. Or the other way round: keep it as a couple, drop its venue staff access.
-- delete from public.memberships m
--  using auth.users u
--  where u.id = m.user_id
--    and lower(u.email) = lower('test@example.com')
--    and m.role = 'venue';

-- 4d. Surgical: one row, by the membership_id from query 1.
-- delete from public.memberships where id = 'PASTE-MEMBERSHIP-ID-HERE';

-- 4e. Clear unclaimed invitations for an address so they cannot re-apply.
-- delete from public.wedding_invitations where lower(email) = lower('test@example.com');
-- delete from public.venue_invites      where lower(email) = lower('test@example.com');
