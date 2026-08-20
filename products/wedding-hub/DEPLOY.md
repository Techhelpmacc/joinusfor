# Deploying Wedding Hub

You deploy **once**. After that, every new venue and every new wedding is data
entry — there is no second deployment, no per-couple hosting, and nothing to
rebuild.

---

## Part 1 — One-time setup (about 20 minutes, done once ever)

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project.
   Pick the London region — it keeps guest data in the UK.
2. Go to **SQL Editor**, paste the whole of `supabase/install.sql`, and run it.
3. Optionally paste `supabase/demo-data.sql` and run that too — it gives you a
   complete worked example wedding to click through.
4. Go to **Project Settings → API** and copy:
   - the **Project URL**
   - the **anon public** key

> The anon key is designed to be public. Every table is protected by row-level
> security, so the key on its own gets you nothing. Never put the **service
> role** key anywhere near this project.

### 2. Point the app at it

Open `public/config.js` and fill in the two values:

```js
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi…'
```

### 3. Deploy the files

Cloudflare Pages is the recommendation — generous free tier, fast in the UK,
and custom domains are included.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → **Pages** → **Upload assets**
2. Drag the **`public`** folder in.
3. Name the project, e.g. `wedding-hub`. You get `wedding-hub.pages.dev`.

There is no build step, no npm, no framework. What you upload is what runs.

Netlify works identically (drag `public` onto the dashboard). The `_redirects`
file already handles the pretty URLs on both.

### 4. Add your own platform domain

Give the app a proper home, e.g. `weddings.yourbusiness.co.uk`:

Cloudflare Pages → your project → **Custom domains** → **Set up a domain**.

### 5. Tell Supabase where the admin lives

**Authentication → URL Configuration**:

- **Site URL**: `https://weddings.yourbusiness.co.uk`
- **Redirect URLs**: add `https://weddings.yourbusiness.co.uk/admin`

Only ever this one domain — the admin always lives here, never on a couple's
own domain. That keeps auth configuration to a single entry forever.

### 6. Make yourself the owner

Visit `https://weddings.yourbusiness.co.uk/admin`, sign in with your email,
click the magic link. Then in the Supabase SQL Editor:

```sql
insert into public.memberships (user_id, role)
select id, 'owner' from auth.users where email = 'you@yourbusiness.co.uk';
```

Reload the admin. You can now see everything.

---

## Part 2 — Onboarding a venue (5 minutes, once per venue you sell to)

```sql
insert into public.venues (slug, name, contact_email, brand_primary)
values ('oakwood-manor', 'Oakwood Manor', 'events@oakwoodmanor.co.uk', '#63755a');

-- after their coordinator has signed in once at /admin
insert into public.memberships (user_id, role, venue_id)
select u.id, 'venue', v.id
from auth.users u, public.venues v
where u.email = 'events@oakwoodmanor.co.uk' and v.slug = 'oakwood-manor';
```

That coordinator can now create and manage every wedding at their venue, and
nothing at anyone else's. They never see another venue's guest lists.

---

## Part 3 — A new wedding (about a minute, once per couple)

In the admin: **Venue** tab → **Start a new wedding**. Names, date, web address.
Then **Settings** to fill in the details and switch status to **Live**.

To hand the couple the keys: ask them to sign in once at `/admin`, then
**Venue → Give the couple access** → enter their email → **Link account**.
They now see exactly one wedding: theirs.

---

## Part 4 — Domains: the three tiers

This is where you make the product feel expensive. The app works out which
wedding to show from the address it was opened at, so all three work at once
from the same single deployment.

### Tier 1 — Included. Path on your domain.

```
weddings.yourbusiness.co.uk/w/john-and-amy
```

Works the moment the wedding is set to Live. Nothing to configure. Fine for
most couples, and it costs you nothing.

### Tier 2 — Venue branded. A subdomain of the venue's own site.

```
johnandamy.oakwoodmanor.co.uk
```

Set up **once per venue**, then every future wedding at that venue works
automatically with no further DNS work. Ask the venue's IT to add one record:

| Type  | Name | Value                    |
|-------|------|--------------------------|
| CNAME | `*`  | `wedding-hub.pages.dev`  |

Then add `*.oakwoodmanor.co.uk` as a custom domain in Cloudflare Pages.

The app takes the first part of the hostname (`johnandamy`) and looks for a
wedding with that web address. So a couple gets their subdomain simply by
having their slug set to `johnandamy` — no DNS changes per wedding.

This is a strong upsell for the venue: their brand, their domain, on every
wedding they sell.

### Tier 3 — The couple's own domain.

```
johnandamyswedding.com
```

This is the one couples actually get excited about, and the one you charge a
premium for. Roughly £12/year for the domain, and about five minutes of work.

**Step 1.** Buy the domain — either the couple buys it, or you buy it for them
and bill it on (buying it yourself is easier to support, and you keep control
if they forget to renew).

**Step 2.** Add it to Cloudflare Pages:
your project → **Custom domains** → **Set up a domain** → `johnandamyswedding.com`.

**Step 3.** Point the DNS at Pages.

If the domain is registered *inside* Cloudflare, this happens automatically.
Otherwise, at whatever registrar holds it:

| Type  | Name  | Value                    |
|-------|-------|--------------------------|
| CNAME | `@`   | `wedding-hub.pages.dev`  |
| CNAME | `www` | `wedding-hub.pages.dev`  |

Some registrars won't allow a CNAME on the root. If so, use their
ALIAS / ANAME / "CNAME flattening" option, or move the domain's nameservers to
Cloudflare — which is easier and free.

HTTPS provisions itself within a few minutes.

**Step 4.** In the admin: **Settings → Own domain** → `johnandamyswedding.com`
→ Save.

That last step is what closes the loop: `resolve_host()` in the database maps
the incoming hostname to the right wedding. `www.` is stripped automatically,
so both spellings land in the right place.

Cloudflare Pages allows around 100 custom domains per project on the free plan,
which is roughly 100 live weddings at Tier 3 — plenty for a long time. When you
outgrow it, **Cloudflare for SaaS** does unlimited hostnames at about 10p each
per month, and needs no change to this codebase.

### What the guest sees

Identical in all three cases. The tier only changes what's in the address bar:

```
johnandamyswedding.com          →  their wedding site
johnandamyswedding.com/u/john-and-amy  →  photo upload (QR target)
```

---

## Part 5 — After the wedding

1. **Photos tab → Upload the official photos.** Drag in the photographer's
   files. They're resized in the browser before uploading, so a 400-photo
   album doesn't cost a fortune in storage.
2. Turn on **Show the album on the wedding site**.
3. If guests uploaded during the day, approve them in
   **Waiting for approval** — or **Approve all** if you trust the room.

The site then quietly becomes an album that the couple keeps for as long as
you keep hosting it. That's your renewal conversation every year.

---

## Costs, realistically

| | Cost |
|---|---|
| Cloudflare Pages | £0 |
| Supabase free tier | £0 — covers roughly 5–10 weddings incl. photos |
| Supabase Pro | ~£20/month — 100GB storage, plenty for dozens of weddings |
| Domain (Tier 3 only) | ~£12/year each |

So your hosting cost per wedding is somewhere between nothing and a couple of
pounds. Everything above that is margin.

---

## Backups

Supabase takes daily backups on Pro. Beyond that, the guest list is the thing
that would really hurt to lose, and it exports to CSV from the admin in one
click. Worth doing after the RSVP deadline, and worth telling the couple you've
done — it reads as professional.
