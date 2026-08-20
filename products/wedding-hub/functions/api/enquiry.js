// ---------------------------------------------------------------------------
//  POST /api/enquiry
//
//  Records an enquiry from the couples page, emails the couple the demo link
//  and RSVP code straight away, and notifies you.
//
//  Needs one Cloudflare Pages environment variable:
//    RESEND_API_KEY   (encrypted — Settings → Variables and Secrets)
//
//  If the key is missing the enquiry is still saved; only the emails are
//  skipped. Losing a lead is worse than losing an email.
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://bdhwlcuprccbcasghyie.supabase.co';
const SUPABASE_KEY = 'sb_publishable_N2TYTEB9Zgu2uAquUE-uIg_A0E-uqnh';

const FROM        = 'Join Us For <hello@joinusfor.co.uk>';
const NOTIFY_TO   = 'hello@joinusfor.co.uk';
const DEMO_URL    = 'https://joinusfor.co.uk/w/john-and-amy';
// The Ashworth-Hughes household is the one worth showing: five people, two
// children on their own menu, and a plus-one to name. It demonstrates far more
// than a couple with two straightforward adults.
const DEMO_CODE   = 'ASHW-7734';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' }
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request' }, 400);
  }

  // Honeypot: a real person never fills a field they cannot see.
  if (body.website) return json({ ok: true });

  const names   = String(body.names   || '').trim().slice(0, 120);
  const email   = String(body.email   || '').trim().slice(0, 200);
  const date    = String(body.date    || '').trim() || null;
  const message = String(body.message || '').trim().slice(0, 2000);

  if (names.length < 2) return json({ ok: false, error: 'Please tell us your names' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: 'That email address does not look right' }, 400);
  }

  // 1. Record it.
  const save = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_enquiry`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_names: names, p_email: email, p_date: date,
      p_message: message, p_source: 'couples'
    })
  });

  if (!save.ok) {
    const detail = await save.text();
    let msg = 'Sorry, something went wrong. Please try again.';
    try { msg = JSON.parse(detail).message || msg; } catch { /* keep default */ }
    return json({ ok: false, error: msg }, 400);
  }

  // 2. Hand them a clean demo. Everyone clicks the same example, so without
  //    this they inherit whatever the last prospect did to it.
  context.waitUntil(
    fetch(`${SUPABASE_URL}/rest/v1/rpc/reset_demo`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    }).catch(() => { /* a stale demo is not worth failing a lead over */ })
  );

  // 3. Emails are best-effort — the lead is already safe.
  const key = env.RESEND_API_KEY;
  if (key) {
    const send = (to, subject, html) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html })
    });

    const toCouple = `
      <div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2b2f29;max-width:34rem">
        <p>Hello ${escapeHtml(names)},</p>
        <p>Thank you for getting in touch about a wedding website. Here is a real
           one you can click through — it works exactly as yours would:</p>
        <p><a href="${DEMO_URL}" style="color:#63755a">${DEMO_URL}</a></p>
        <p>Scroll down to <strong>Will you join us?</strong> and enter the code
           <strong>${DEMO_CODE}</strong>. That is a family of five, so you will
           see how it handles children on their own menu, and a guest who has not
           been named yet — exactly what your own invitations will look like.</p>
        <p>Have a look, and reply to this email with anything you would like
           changed or any questions. If you would like to go ahead, all we need
           to start is your names and your date.</p>
        <p>Best wishes,<br>Join Us For</p>
        <p style="font-size:13px;color:#666c62">hello@joinusfor.co.uk</p>
      </div>`;

    const toYou = `
      <div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
        <h2 style="margin:0 0 .75rem">New enquiry</h2>
        <p><strong>Names:</strong> ${escapeHtml(names)}<br>
           <strong>Email:</strong> ${escapeHtml(email)}<br>
           <strong>Date:</strong> ${escapeHtml(date || 'not given')}</p>
        ${message ? `<p><strong>Message:</strong><br>${escapeHtml(message)}</p>` : ''}
      </div>`;

    // Never let a mail failure turn into a failed submission.
    context.waitUntil(Promise.allSettled([
      send(email, 'Your wedding website — have a look', toCouple),
      send(NOTIFY_TO, `New enquiry — ${names}`, toYou)
    ]));
  }

  return json({ ok: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
