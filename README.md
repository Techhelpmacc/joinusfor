# Wedding Hub

A wedding website you build **once** and a venue resells to **every couple** as
a paid add-on.

One deployment serves every venue and every wedding. Adding a couple is filling
in a form — there is no per-wedding site, no per-wedding hosting, and nothing
to update when WordPress has a bad week.

```
you (platform owner)
 └── venue            ← you sell to them once
      └── wedding     ← they resell to each couple
           ├── invites → guests      RSVP + meals + dietary
           └── photos                official + guest uploads, moderated
```

---

## What it does

**Before the day — invitations and RSVPs**
- A private site per couple: names, date, their story, running order, and
  cards for parking, accommodation, dress code, gifts.
- Guests find their invitation by the code printed on it, or by name.
- One household at a time — the full guest list is never publicly readable.
- Per guest: attending or not, meal choice, dietary requirements. Plus-ones
  name themselves.
- Live dashboard: attending / declined / no reply, catering totals, dietary
  list, messages and song requests. CSV export for the venue kitchen.
- "Copy email addresses" for everyone still to reply.

**After the day — photographs**
- You or the couple drag in the photographer's files. Resized in the browser
  before upload, so storage stays cheap.
- Guests upload from their phones via a QR code on the tables.
- Everything guests send is **held for approval** before it appears.
- The album lives at the same address the invitation did.

---

## Stack

| | |
|---|---|
| Front end | Plain HTML, CSS and ES modules. **No build step.** |
| Back end | Supabase — Postgres, storage, magic-link auth |
| Hosting | Cloudflare Pages (or Netlify) |
| Isolation | Postgres row-level security, not application code |

No npm install, no framework, no bundler. What's in `public/` is what runs,
which means deploying is dragging a folder and the thing is still readable in
three years.

---

## Layout

```
wedding-hub/
  DEPLOY.md               <- start here
  supabase/
    install.sql           <- paste into the SQL editor, once
    demo-data.sql         <- a complete worked example wedding
  public/                 <- this folder is the whole website
    config.js             <- the only file you edit
    index.html            <- sales page, for pitching to venues
    wedding.html          <- the guest site
    upload.html           <- guest photo upload (QR target)
    admin.html            <- managed by couple + venue + you
    _redirects            <- pretty URLs
    assets/
      app.js              <- Supabase client, tenant resolution, helpers
      wedding.js  wedding.css
      upload.js
      admin.js    admin.css
```

---

## How a request finds the right wedding

`resolveSlug()` in `assets/app.js`, in order:

1. `?w=slug` — previewing
2. `/w/slug` — path on your platform domain
3. **custom domain** — `johnandamyswedding.com`, resolved by the database
4. **first hostname label** — `johnandamy.oakwoodmanor.co.uk`, wildcard DNS
5. `DEFAULT_SLUG` from `config.js`

So all three domain tiers run off one deployment simultaneously. See
[DEPLOY.md](DEPLOY.md) Part 4.

---

## Security notes worth knowing

- **The guest list is not public.** `invites` and `guests` have no public read
  policy at all. Guests reach their own household through `rsvp_lookup()`,
  which returns exactly one match and never a list.
- **Writing an RSVP needs the invite code**, not just a guest id — so a leaked
  id can't be used to change someone's reply.
- **Guest uploads are always pending.** Nothing a guest sends appears on the
  site until it's approved.
- **The anon key is meant to be public.** Row-level security is what protects
  the data. Never deploy the service-role key.
- **Draft weddings are invisible** — `status = 'live'` gates every public read.
- Photo *files* in storage are served from public URLs. A pending photo is
  therefore reachable by anyone who knows its exact random path, though it
  won't be listed anywhere. If a venue needs stricter, switch the bucket to
  private and swap `publicPhotoUrl()` for signed URLs.

---

## Themes

Four, switchable per wedding from a dropdown in Settings:

| | |
|---|---|
| `ivory-sage` | warm ivory, sage, soft charcoal — the default |
| `blush-gold` | blush with antique gold |
| `midnight-ink` | dark and dramatic, gold accent |
| `coastal-linen` | pale blue-grey and sand |

Every colour is a CSS custom property in `wedding.css`. Adding a fifth theme is
one block of variables — no other file changes.

---

## Deliberate omissions

Worth knowing what isn't here, so you can price and scope honestly:

- **No payment handling.** The venue bills the couple however they already do.
- **No email sending.** RSVPs land in the dashboard; the "copy addresses"
  button covers chasing. Wiring Resend or Postmark to a Supabase Edge Function
  is the obvious next step if venues ask for automatic reminders.
- **No seating plan.** Frequently requested, genuinely fiddly, and better sold
  as a second phase.
- **No multi-language.** Fine for the UK market; a real job if you need it.

---

Start with **[DEPLOY.md](DEPLOY.md)**.
