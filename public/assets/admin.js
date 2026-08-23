// ---------------------------------------------------------------------------
//  Admin. One screen for the couple, the venue and you — what you can see is
//  decided by row-level security, not by hiding buttons.
// ---------------------------------------------------------------------------
import { sb, cfg, $, $$, el, formatDate, daysUntil, downscaleImage, randomName,
         publicPhotoUrl, sendInviteEmail, toast } from './app.js?v=20';

const BUILD = '2026-08-23-a';
window.__ADMIN_BUILD = BUILD;

let USER = null, ROLES = [], WEDDINGS = [], W = null;
let INVITES = [], GUESTS = [], PHOTOS = [], VENUES = [];
let WVENUE = null;               // venue that hosts W, for inherited location details
let EDITING = null;              // id of the guest row currently being edited

const isStaff = () => ROLES.some(r => r.role === 'venue' || r.role === 'owner');
const isCoupleOnly = () => !isStaff() && WEDDINGS.length === 1;

/**
 * Turn free text into a safe web address: "Graham & LInda" -> "graham-and-linda".
 * keepTrailingDash is for live typing, so a hyphen isn't eaten as you type it.
 */
function slugify(s, keepTrailingDash = false) {
  let out = (s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '');
  if (!keepTrailingDash) out = out.replace(/-+$/, '');
  return out;
}

// ------------------------------------------------------------------- boot --
(async function boot() {
  wireAuth();
  const { data: { session } } = await sb.auth.getSession();
  session ? await start(session.user) : show('loginView');

  sb.auth.onAuthStateChange((_e, s) => {
    if (s?.user && !USER) start(s.user);
    if (!s && USER) location.reload();
  });
})();

function show(id) {
  ['loginView', 'homeView', 'coupleWelcomeView', 'appView', 'noAccess']
    .forEach(v => { $('#' + v).hidden = v !== id; });

  const inWedding = id === 'appView';
  const signedIn  = inWedding || id === 'homeView' || id === 'coupleWelcomeView';
  const onHome = id === 'homeView';

  $('#signOut').hidden = !signedIn;
  $('#weddingPicker').hidden = !inWedding;
  $('#viewSite').hidden = !inWedding;
  $('#backHome').hidden = !inWedding;
  $('#venueSettingsLink').hidden = !(onHome && isStaff());
}

async function start(user) {
  USER = user;

  const { data: mem } = await sb.from('memberships').select('*');
  ROLES = mem || [];

  // Show who's signed in and as what. Without this, "why can't I do X?" is
  // guesswork — for you and for a venue on the phone.
  const roleLabel = ROLES.length
    ? [...new Set(ROLES.map(r => r.role))].join(', ')
    : 'no access';
  $('#whoami').textContent = `${user.email} · ${roleLabel}`;

  const { data: weds } = await sb.from('weddings')
    .select('*').order('wedding_date', { ascending: false });

  // Live weddings are publicly readable by design (that's how guest sites
  // work), so the query above returns weddings this user cannot manage.
  // Narrow it to what their membership actually covers, or a couple would
  // see every other couple listed in the picker.
  const isPlatformOwner = ROLES.some(r => r.role === 'owner');
  const myWeddings = new Set(ROLES.filter(r => r.wedding_id).map(r => r.wedding_id));
  const myVenues   = new Set(ROLES.filter(r => r.venue_id).map(r => r.venue_id));
  WEDDINGS = isPlatformOwner
    ? (weds || [])
    : (weds || []).filter(w => myWeddings.has(w.id) || myVenues.has(w.venue_id));

  if (!WEDDINGS.length && !isStaff()) return show('noAccess');

  if (isStaff()) {
    const { data: v } = await sb.from('venues').select('*').order('name');
    // Venues are publicly readable so guest sites can show their branding.
    // In the admin that would leak the whole client list to every venue, so
    // narrow it to the ones this account actually manages.
    VENUES = isPlatformOwner
      ? (v || [])
      : (v || []).filter(x => myVenues.has(x.id));
    $('#nvenue').innerHTML = '';
    VENUES.forEach(x => $('#nvenue').append(el('option', { value: x.id, text: x.name })));
  }

  const picker = $('#weddingPicker');
  picker.innerHTML = '';
  WEDDINGS.forEach(w => picker.append(el('option', {
    value: w.id,
    text: `${w.partner_a} & ${w.partner_b} — ${formatDate(w.wedding_date, 'short')}`
         + (w.status !== 'live' ? ` (${w.status})` : '')
  })));
  picker.onchange = () => selectWedding(picker.value);

  wireTabs();
  wireGuestTab();
  wireEverything();

  // Load menus for the first venue if there's only one (after listener is set up)
  if (isStaff() && VENUES.length === 1) {
    $('#nvenue').value = VENUES[0].id;
    $('#nvenue').dispatchEvent(new Event('change'));
  }

  // Land on a list of weddings, not inside one. Dropping straight into a single
  // wedding's numbers assumes you already know which one you came for — and
  // looks broken to a venue that has none yet.
  await renderHome();
}

async function renderHome() {
  // If user is a couple with one wedding, show welcome screen instead
  if (isCoupleOnly()) {
    W = WEDDINGS[0];
    renderCoupleWelcome();
    return;
  }

  const grid = $('#homeGrid');
  const staff = isStaff();

  $('#homeNew').hidden = !staff;
  $('#homeNewEmpty').hidden = !staff;
  $('#homeTitle').textContent = staff ? 'Your weddings' : 'Your wedding';

  if (!WEDDINGS.length) {
    grid.innerHTML = '';
    $('#homeEmpty').hidden = false;
    $('#homeSub').textContent = '';
    show('homeView');
    return;
  }

  $('#homeEmpty').hidden = true;
  $('#homeSub').textContent = WEDDINGS.length === 1
    ? 'One wedding.'
    : `${WEDDINGS.length} weddings.`;

  // One query for every wedding's replies, rather than one per card.
  const ids = WEDDINGS.map(w => w.id);
  const { data: gs } = await sb.from('guests')
    .select('wedding_id, rsvp_status').in('wedding_id', ids);

  const tally = {};
  (gs || []).forEach(g => {
    const t = tally[g.wedding_id] || (tally[g.wedding_id] = { total: 0, replied: 0, coming: 0 });
    t.total++;
    if (g.rsvp_status !== 'pending') t.replied++;
    if (g.rsvp_status === 'attending') t.coming++;
  });

  grid.innerHTML = '';
  WEDDINGS.forEach(w => {
    const t = tally[w.id] || { total: 0, replied: 0, coming: 0 };
    const pct = t.total ? Math.round((t.replied / t.total) * 100) : 0;

    const card = el('button', {
      class: 'wed-card', type: 'button',
      onclick: () => openWedding(w.id)
    },
      el('div', {},
        el('span', { class: 'wed-card__names', text: `${w.partner_a} & ${w.partner_b}` }),
        // Each venue's demo carries its own id in the slug, so match the prefix
        // rather than the whole thing or only the first venue ever gets a badge.
        (w.slug || '').startsWith('demo-wedding') ? el('span', { style: 'display:block;color:#dc3545;font-size:0.85rem;font-weight:600;margin-top:0.25rem;text-transform:uppercase;letter-spacing:0.05em', text: 'Demo' }) : null
      ),
      el('span', { class: 'wed-card__date', text: formatDate(w.wedding_date) })
    );

    const meta = el('div', { class: 'wed-card__meta' });
    meta.append(el('span', {
      class: `pill pill--${w.status === 'live' ? 'yes' : w.status === 'draft' ? 'wait' : 'no'}`,
      text: w.status === 'live' ? 'Live' : w.status === 'draft' ? 'Draft' : 'Archived'
    }));
    if (w.wedding_complete) {
      meta.append(el('span', { class: 'pill pill--yes', text: 'Been and gone' }));
    }
    const days = daysUntil(w.wedding_date);
    if (days !== null && days > 0 && !w.wedding_complete) {
      meta.append(el('span', { class: 'wed-card__stat', text: `${days} days to go` }));
    }
    card.append(meta);

    if (t.total) {
      card.append(el('div', { class: 'bar-mini' }, el('span', { style: `width:${pct}%` })));
      card.append(el('span', { class: 'wed-card__stat' },
        el('strong', { text: String(t.replied) }), ` of ${t.total} replied · `,
        el('strong', { text: String(t.coming) }), ' coming'));
    } else {
      card.append(el('span', { class: 'wed-card__stat', style: 'margin-top:.75rem',
                               text: 'No guests added yet' }));
    }

    grid.append(card);
  });

  show('homeView');
}

async function renderCoupleWelcome() {
  if (!isCoupleOnly() || !W) return;

  $('#backHome').hidden = true;  // Hide back button on welcome screen

  const wed = W;
  $('#welcomePartners').textContent = `Welcome ${wed.partner_a} & ${wed.partner_b}!`;

  // For now, just show a simple to-do list without loading data
  const todos = [
    { label: 'Fill out your RSVP', desc: 'Let us know who\'s coming', done: false },
    { label: 'Select meal preferences', desc: 'Choose your meal for the reception', done: false },
    { label: 'Add dietary requirements', desc: 'Tell us about any allergies or preferences', done: false },
    { label: 'View wedding schedule', desc: 'See the timeline for the day', done: false },
    { label: 'Check guest list', desc: 'See who you\'ve invited', done: false },
    { label: 'View photo album', desc: 'Browse photos from the wedding', done: false }
  ];

  const todoList = $('#todoList');
  todoList.innerHTML = '';
  todos.forEach(todo => {
    const item = el('li', { class: `todo-item ${todo.done ? 'todo-item--done' : ''}` },
      el('div', { class: 'todo-item__check' }, todo.done ? '✓' : ''),
      el('div', { class: 'todo-item__text' },
        el('div', { class: 'todo-item__label', text: todo.label }),
        el('div', { class: 'todo-item__desc', text: todo.desc })
      )
    );
    todoList.append(item);
  });

  // Wire up buttons
  $('#viewWeddingBtn').onclick = () => openWedding(wed.id);
  $('#backToWeddingBtn').onclick = () => openWedding(wed.id);

  show('coupleWelcomeView');
}

async function openWedding(id) {
  await selectWedding(id);
  switchTab('overview');
  show('appView');
}

/** From the home screen, straight to the form that creates one. */
function startNewWedding() {
  const form = $('#homeCreateForm');
  if (form) {
    form.hidden = false;
    $('#npa').focus();
  }
}

async function selectWedding(id) {
  W = WEDDINGS.find(w => w.id === id);
  if (!W) return;
  $('#weddingPicker').value = id;
  $('#viewSite').onclick = () => window.open(siteUrl(), '_blank', 'noopener');

  // Repurpose back button: couples see "View checklist", staff see "All weddings"
  const backBtn = $('#backHome');
  const viewSiteBtn = $('#viewSite');
  const couple = isCoupleOnly();

  // Show both buttons on individual wedding view
  backBtn.hidden = false;
  viewSiteBtn.hidden = false;

  if (couple) {
    backBtn.textContent = '← View checklist';
    backBtn.onclick = () => renderCoupleWelcome();
  } else {
    backBtn.textContent = '← All weddings';
    backBtn.onclick = () => { renderHome(); show('homeView'); };
  }

  // Hide admin-only sections for couples
  $('#inviteCouplePanel').hidden = couple;
  $('#addInvitePanel').hidden = couple;  // Couples can't add households
  $('#addGuestPanel').hidden = !couple;  // Couples CAN add individual guests
  $('#afterBanner').hidden = couple;  // Couples can't change settings

  // For couples: show appropriate banner based on status
  if (couple) {
    $('#draftBanner').hidden = W.status !== 'draft';
    $('#liveBanner').hidden = W.status !== 'live';

    $('#goLiveBtn').onclick = async () => {
      $('#goLiveBtn').disabled = true;
      const { data, error } = await sb.rpc('couple_publish_wedding', { p_wedding: W.id });
      if (error) {
        toast(error.message, 'error');
        $('#goLiveBtn').disabled = false;
      } else {
        W.status = 'live';
        $('#draftBanner').hidden = true;
        $('#liveBanner').hidden = false;
        toast('Your wedding site is now live!', 'success');
      }
    };

    $('#viewLiveBtn').onclick = () => window.open(siteUrl(), '_blank', 'noopener');
  } else {
    // For staff: hide couple-only banners
    $('#draftBanner').hidden = true;
    $('#liveBanner').hidden = true;
  }

  // Hide admin-only tabs for couples
  if (couple) {
    $$('.tab').forEach(tab => {
      const panelName = tab.dataset.tab;
      // Couples only see: overview, guests, photos
      if (!['overview', 'guests', 'photos'].includes(panelName)) {
        tab.hidden = true;
      }
    });
  } else {
    // Staff see all tabs
    $$('.tab').forEach(tab => { tab.hidden = false; });
  }

  await Promise.all([loadGuests(), loadPhotos(), loadContent(), loadWeddingVenue()]);
  fillSettings();
  renderOverview();
  await loadAccess();
}

function siteUrl() {
  return W.custom_domain ? `https://${W.custom_domain}` : `${location.origin}/w/${W.slug}`;
}
function uploadUrl() {
  const base = W.custom_domain ? `https://${W.custom_domain}` : location.origin;
  // The key travels in the link so a scanned QR needs no typing.
  return `${base}/u/${W.slug}${W.upload_key ? `?k=${W.upload_key}` : ''}`;
}

// ------------------------------------------------------------------- auth --
function wireAuth() {
  // Password toggle
  $('#togglePassword').addEventListener('click', e => {
    e.preventDefault();
    const field = $('#passwordField');
    const toggle = $('#togglePassword');
    if (field.hidden) {
      field.hidden = false;
      toggle.textContent = 'Use magic link instead';
      $('#loginBtn').textContent = 'Sign in with password';
    } else {
      field.hidden = true;
      toggle.textContent = 'Use a password instead';
      $('#loginBtn').textContent = 'Send me a login link';
      $('#password').value = '';
    }
  });

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const btn = $('#loginBtn');
    const msg = $('#loginMsg');

    btn.disabled = true;
    btn.textContent = password ? 'Signing in…' : 'Sending…';
    msg.textContent = '';

    if (password) {
      // Password sign-in. Doesn't touch email, so it can't be rate limited.
      const { error } = await sb.auth.signInWithPassword({ email, password });
      btn.disabled = false; btn.textContent = 'Sign in with password';
      if (error) msg.textContent = error.message;
      // On success onAuthStateChange takes over and loads the app.
      return;
    }

    // No password: fall back to a magic link. Come back to whatever address
    // we're on now, so this works unchanged on localhost and in production.
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname }
    });

    if (error) {
      btn.disabled = false; btn.textContent = 'Send me a login link';
      msg.textContent = error.message;
    } else {
      // Success: clear email, disable form, show clear message
      $('#email').value = '';
      $('#email').disabled = true;
      $('#togglePassword').disabled = true;
      btn.disabled = true;
      btn.textContent = '✓ Link sent!';
      msg.textContent = 'Check your inbox — the link signs you straight in. It may take a minute.';
    }
  });

  const out = async () => { await sb.auth.signOut(); location.reload(); };
  $('#signOut').onclick = out;
  $('#signOut2').onclick = out;
}

function wireTabs() {
  $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
}

function wireGuestTab() {
  console.log('wireGuestTab called, familyForm:', $('#addFamilyForm'));
  const guestFields = $('#guestFields');
  const familyFields = $('#familyFields');
  let guestRowCount = 0, familyRowCount = 0;

  function createGuestRow(parent, counter, isChild) {
    const id = `row-${counter}`;
    const row = el('div', { id, style: 'display:grid;grid-template-columns:1fr auto;gap:0.75rem;align-items:end;padding:0.75rem;background:var(--bg);border-radius:var(--radius)' },
      el('div', {},
        el('label', { class: 'lbl', style: 'display:block', text: isChild ? 'Child name' : 'Adult name' }),
        el('input', { type: 'text', class: 'in', placeholder: 'e.g. Sarah Smith', style: 'width:100%', 'data-is-child': isChild })),
      el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: '−',
        onclick: () => document.getElementById(id)?.remove() })
    );
    parent.append(row);
  }

  // Individual guests - Add Adult/Child
  $('#addGuestAdult').onclick = (e) => {
    e.preventDefault();
    createGuestRow(guestFields, guestRowCount++, false);
  };
  $('#addGuestChild').onclick = (e) => {
    e.preventDefault();
    createGuestRow(guestFields, guestRowCount++, true);
  };
  createGuestRow(guestFields, guestRowCount++, false);

  $('#addGuestForm').onsubmit = async (e) => {
    e.preventDefault();
    const rows = guestFields.querySelectorAll('[id^="row-"]');
    const guests = [];
    rows.forEach(row => {
      const input = row.querySelector('input[type="text"]');
      const name = input.value.trim();
      const isChild = input.getAttribute('data-is-child') === 'true';
      if (name) guests.push({ name, isChild });
    });

    if (!guests.length) return toast('Add at least one guest', 'error');

    // Create individual invites for each guest so they can login separately
    let added = 0;
    for (const g of guests) {
      const { data: newInvite, error: invError } = await sb.from('invites')
        .insert({
          wedding_id: W.id,
          household_name: g.name,
          invite_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
          invited_to: 'all'
        })
        .select('id')
        .single();

      if (invError || !newInvite) {
        toast(`Error adding ${g.name}`, 'error');
        continue;
      }

      const { error: guestError } = await sb.from('guests').insert({
        invite_id: newInvite.id,
        wedding_id: W.id,
        full_name: g.name,
        is_child: g.isChild,
        rsvp_status: 'pending'
      });

      if (!guestError) added++;
    }

    if (added > 0) {
      toast(`${added} guest${added !== 1 ? 's' : ''} added with login codes!`, 'success');
      guestFields.innerHTML = '';
      createGuestRow(guestFields, guestRowCount++, false);
      await loadGuests();
      renderGuestTable();
      renderOverview();
    }
  };

  // Family group - Add Adult/Child
  $('#addFamilyAdult').onclick = (e) => {
    e.preventDefault();
    createGuestRow(familyFields, 100 + familyRowCount++, false);
  };
  $('#addFamilyChild').onclick = (e) => {
    e.preventDefault();
    createGuestRow(familyFields, 100 + familyRowCount++, true);
  };

  $('#addFamilyForm').onsubmit = async (e) => {
    e.preventDefault();
    console.log('Family form submitted');
    const familyName = $('#familyName').value.trim();
    console.log('Family name:', familyName);
    if (!familyName) return toast('Enter family name', 'error');

    const rows = familyFields.querySelectorAll('[id^="row-"]');
    const members = [];
    rows.forEach(row => {
      const input = row.querySelector('input[type="text"]');
      const name = input.value.trim();
      const isChild = input.getAttribute('data-is-child') === 'true';
      if (name) members.push({ name, isChild });
    });

    console.log('Family members:', members);
    if (!members.length) return toast('Add at least one family member', 'error');

    console.log('Creating invite for:', familyName);
    const { data: newInvite, error: invError } = await sb.from('invites')
      .insert({
        wedding_id: W.id, household_name: familyName,
        invite_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
        invited_to: 'all'
      })
      .select('id, invite_code')
      .single();

    console.log('Invite result:', { newInvite, invError });
    if (invError || !newInvite) return toast('Could not create family group: ' + (invError?.message || 'unknown error'), 'error');

    const toInsert = members.map(m => ({
      invite_id: newInvite.id, wedding_id: W.id, full_name: m.name,
      is_child: m.isChild, rsvp_status: 'pending'
    }));

    console.log('Inserting guests:', toInsert);
    const { error: guestError } = await sb.from('guests').insert(toInsert);
    console.log('Guest insert result:', guestError);

    if (guestError) {
      toast(guestError.message, 'error');
    } else {
      toast(`${familyName} created! Invite code: ${newInvite.invite_code}`, 'success');
      $('#familyName').value = '';
      familyFields.innerHTML = '';
      await loadGuests();
      renderGuestTable();
      renderOverview();
    }
  };
}
function switchTab(name) {
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
}

// ------------------------------------------------------------------ data ---
async function loadGuests() {
  const [{ data: inv }, { data: gs }] = await Promise.all([
    sb.from('invites').select('*').eq('wedding_id', W.id).order('household_name'),
    sb.from('guests').select('*').eq('wedding_id', W.id).order('full_name')
  ]);
  INVITES = inv || [];
  GUESTS = gs || [];
  renderGuestTable();
}

async function loadPhotos() {
  const { data } = await sb.from('photos').select('*')
    .eq('wedding_id', W.id).order('created_at', { ascending: false });
  PHOTOS = data || [];
  renderPhotos();
  $('#galleryVisible').checked = !!W.gallery_visible;
  $('#guestUpload').checked = !!W.guest_upload_enabled;
  $('#uploadUrl').textContent = uploadUrl();
  $('#uploadKey').textContent = W.upload_key || '—';
}

async function loadContent() {
  const [{ data: sch }, { data: inf }] = await Promise.all([
    sb.from('schedule_items').select('*').eq('wedding_id', W.id).order('sort_order'),
    sb.from('info_blocks').select('*').eq('wedding_id', W.id).order('sort_order')
  ]);
  renderSchedule(sch || []);
  renderInfo(inf || []);
}

// -------------------------------------------------------------- overview ---
function renderOverview() {
  $('#draftBanner').classList.toggle('hide', W.status === 'live');

  // Nudge, not automation — switching to album mode stays the couple's call.
  const days = daysUntil(W.wedding_date);
  const hasBeen = days !== null && days < 0;
  $('#afterBanner').classList.toggle('hide', !(hasBeen && !W.wedding_complete));

  const attending = GUESTS.filter(g => g.rsvp_status === 'attending');
  const declined  = GUESTS.filter(g => g.rsvp_status === 'declined');
  const pending   = GUESTS.filter(g => g.rsvp_status === 'pending');
  const replied   = INVITES.filter(i => i.responded_at).length;

  const stats = $('#stats');
  stats.innerHTML = '';
  [
    ['Invited', GUESTS.length, ''],
    ['Attending', attending.length, 'stat--good'],
    ['Declined', declined.length, ''],
    ['No reply', pending.length, pending.length ? 'stat--warn' : ''],
    ['Households replied', `${replied}/${INVITES.length}`, '']
  ].forEach(([label, n, cls]) => stats.append(
    el('div', { class: `stat ${cls}` },
      el('div', { class: 'stat__n', text: String(n) }),
      el('div', { class: 'stat__l', text: label }))
  ));

  // Chasers
  const waiting = INVITES.filter(i => !i.responded_at);
  const box = $('#chasers');
  box.innerHTML = '';
  if (!waiting.length) {
    box.append(el('p', { class: 'empty', text: 'Everyone has replied.' }));
  } else {
    const rows = waiting.map(i => el('tr', {},
      el('td', { text: i.household_name }),
      el('td', {}, el('span', { class: 'code', text: i.invite_code })),
      el('td', { class: 'muted', text: i.email || '—' }),
      el('td', { class: 'num', text: String(GUESTS.filter(g => g.invite_id === i.id).length) })
    ));
    box.append(table(['Household', 'Code', 'Email', 'Seats'], rows));
  }
  $('#copyChasers').onclick = () => {
    const emails = waiting.map(i => i.email).filter(Boolean).join(', ');
    if (!emails) return toast('No email addresses saved for those households.', 'error');
    navigator.clipboard.writeText(emails);
    toast(`Copied ${emails.split(',').length} address(es).`, 'success');
  };

  // Catering (staff only)
  if (isStaff()) {
    const cat = $('#catering');
    cat.innerHTML = '';
    const adults   = attending.filter(g => !g.is_child);
    const children = attending.filter(g => g.is_child);
    const diets    = attending.filter(g => g.dietary);

    const tally = list => {
      const t = {};
      list.forEach(g => { const m = g.meal_choice || 'Not chosen'; t[m] = (t[m] || 0) + 1; });
      return Object.entries(t).sort((a, b) => b[1] - a[1]);
    };
    const mealTable = rows => table(['Choice', 'Covers'], rows.map(([m, n]) =>
      el('tr', {}, el('td', { text: m }), el('td', { class: 'num', text: String(n) }))));

    if (!attending.length) {
      cat.append(el('p', { class: 'empty', text: 'Nothing to report until people start replying.' }));
    } else {
      cat.append(el('p', { style: 'margin:0 0 1rem;font-size:1.05rem' },
        el('strong', { text: `${adults.length} adult${adults.length === 1 ? '' : 's'}` }),
        children.length
          ? ` · ${children.length} child${children.length === 1 ? '' : 'ren'} · ${attending.length} covers total`
          : ' attending'));

      cat.append(el('p', { class: 'lbl', style: 'margin:1.25rem 0 .5rem', text: 'Adults' }));
      cat.append(mealTable(tally(adults)));

      if (children.length) {
        cat.append(el('p', { class: 'lbl', style: 'margin:1.25rem 0 .5rem', text: 'Children' }));
        cat.append(mealTable(tally(children)));
      }

      if (diets.length) {
        cat.append(el('p', { class: 'lbl', style: 'margin:1.25rem 0 .5rem', text: 'Dietary requirements' }));
        cat.append(table(['Guest', 'Requirement'], diets.map(g =>
          el('tr', {},
            el('td', { text: g.full_name + (g.is_child ? ' (child)' : '') }),
            el('td', { text: g.dietary })))));
      }
    }
  } else {
    $('#catering').parentElement.hidden = true;
  }

  // Messages
  const msgs = INVITES.filter(i => i.message || i.song_request);
  const mbox = $('#messages');
  mbox.innerHTML = '';
  if (!msgs.length) mbox.append(el('p', { class: 'empty', text: 'No messages yet.' }));
  else mbox.append(table(['From', 'Message', 'Song request'], msgs.map(i =>
    el('tr', {},
      el('td', { text: i.household_name }),
      el('td', { text: i.message || '—' }),
      el('td', { class: 'muted', text: i.song_request || '—' })))));
}

function table(headers, rows) {
  return el('div', { class: 'tbl-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, ...headers.map(h => el('th', { text: h })))),
      el('tbody', {}, ...rows)));
}

// ---------------------------------------------------------------- guests ---
function renderGuestTable() {
  const q = ($('#guestSearch')?.value || '').toLowerCase();
  const filter = $('#guestFilter')?.value || '';
  const host = $('#guestTable');
  host.innerHTML = '';

  // Find couple's invite
  const couple = W ? INVITES.find(i => i.household_name.includes(W.partner_a) && i.household_name.includes(W.partner_b)) : null;
  const coupleGuests = couple ? GUESTS.filter(g => g.invite_id === couple.id) : [];
  console.log('Couple:', couple?.household_name, 'Couple guests:', coupleGuests.length, coupleGuests.map(g => g.full_name));

  const rows = [];

  // 1. Show just the couple (first row of couple's invite)
  if (couple) {
    const coupleEntry = coupleGuests.find(g =>
      g.full_name === `${W.partner_a} & ${W.partner_b}`
    );
    if (coupleEntry && (!filter || coupleEntry.rsvp_status === filter)) {
      rows.push(el('tr', {},
        el('td', {}, el('strong', { text: couple.household_name })),
        el('td', {}, el('span', { class: 'code', text: couple.invite_code })),
        el('td', { text: coupleEntry.full_name }),
        el('td', {}, statusPill(coupleEntry.rsvp_status)),
        el('td', { class: 'muted', text: coupleEntry.meal_choice || '—' }),
        el('td', { class: 'muted', text: coupleEntry.dietary || '—' }),
        el('td', {}, el('div', { class: 'row' },
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Edit',
            onclick: () => { EDITING = coupleEntry.id; renderGuestTable(); } })))));
    }
  }

  // 2. Show "Individual guests" header and their guests (other guests under couple's invite)
  const individualGuests = coupleGuests.filter(g =>
    g.full_name !== `${W.partner_a} & ${W.partner_b}`
  ).filter(g => !filter || g.rsvp_status === filter)
   .filter(g => !q || g.full_name.toLowerCase().includes(q));

  if (individualGuests.length > 0) {
    rows.push(
      el('tr', { style: 'background:transparent' },
        el('td', { colspan: 7, style: 'padding:1rem 0;font-weight:600;border:0;border-top:2px solid var(--line);color:var(--muted);text-transform:uppercase;font-size:0.8rem', text: 'Individual guests' }))
    );
    individualGuests.forEach((g, i) => {
      // Don't show household name for individual guests - they're under couple's invite but shouldn't display it
      const row = g.id === EDITING ? guestEditRow(couple, g, i) : guestViewRow(couple, g, i);
      // Replace the household cell with blank for individual guests
      if (i === 0 && row.children[0]) {
        row.children[0].innerHTML = '';
        row.children[1].innerHTML = ''; // Also blank the code column
      }
      rows.push(row);
    });
  }

  // 3. Separate individual guests (own invites with 1 guest) from family groups
  const otherInvites = INVITES.filter(i => i !== couple);
  const individualInvites = [], familyInvites = [];

  otherInvites.forEach(inv => {
    const invGuests = GUESTS.filter(g => g.invite_id === inv.id);
    // Individual invite: household name matches guest name and only 1 guest
    if (invGuests.length === 1 && invGuests[0].full_name === inv.household_name) {
      individualInvites.push(inv);
    } else {
      familyInvites.push(inv);
    }
  });

  // Show individual guests from NEW invites (not couple's)
  if (individualInvites.length > 0) {
    if (coupleGuests.some(g => g.full_name !== `${W.partner_a} & ${W.partner_b}`)) {
      // There are also old-style individual guests, add separator
    } else {
      // Only new-style individual guests, show header
      if (!rows.some(r => r.textContent?.includes('Individual guests'))) {
        rows.push(
          el('tr', { style: 'background:transparent' },
            el('td', { colspan: 7, style: 'padding:1rem 0;font-weight:600;border:0;border-top:2px solid var(--line);color:var(--muted);text-transform:uppercase;font-size:0.8rem', text: 'Individual guests' }))
        );
      }
    }

    individualInvites.forEach(inv => {
      const mine = GUESTS.filter(g => g.invite_id === inv.id)
        .filter(g => !filter || g.rsvp_status === filter)
        .filter(g => !q || g.full_name.toLowerCase().includes(q)
                        || inv.household_name.toLowerCase().includes(q)
                        || inv.invite_code.toLowerCase().includes(q));
      if (!mine.length) return;

      mine.forEach((g, i) => rows.push(
        g.id === EDITING ? guestEditRow(inv, g, i) : guestViewRow(inv, g, i)
      ));
    });
  }

  // Show family groups
  if (familyInvites.length > 0) {
    rows.push(
      el('tr', { style: 'background:transparent' },
        el('td', { colspan: 7, style: 'padding:1rem 0;font-weight:600;border:0;border-top:2px solid var(--line);color:var(--muted);text-transform:uppercase;font-size:0.8rem', text: 'Family groups' }))
    );

    familyInvites.forEach(inv => {
      const mine = GUESTS.filter(g => g.invite_id === inv.id)
        .filter(g => !filter || g.rsvp_status === filter)
        .filter(g => !q || g.full_name.toLowerCase().includes(q)
                        || inv.household_name.toLowerCase().includes(q)
                        || inv.invite_code.toLowerCase().includes(q));
      if (!mine.length) return;

      mine.forEach((g, i) => {
        const row = g.id === EDITING ? guestEditRow(inv, g, i) : guestViewRow(inv, g, i);

        // Add collapse button on first row of family
        if (i === 0) {
          const familyId = `fam-${inv.id}`;
          row.setAttribute('data-family-first', familyId);
          row.style.cursor = 'pointer';

          // Add expand/collapse chevron
          const firstCell = row.querySelector('td:first-child');
          const chevron = el('span', {
            style: 'display:inline-block;margin-right:0.5rem;font-size:1.8rem;line-height:1;vertical-align:middle;color:var(--accent);font-weight:900;cursor:pointer;min-width:1.5rem;position:relative;top:-0.15rem',
            text: String.fromCharCode(9658),
            className: `chevron-${familyId}`
          });
          firstCell.prepend(chevron);

          // Toggle on click
          row.onclick = (e) => {
            if (e.target.classList.contains('btn') || e.target.closest('.btn')) return;
            const allMembers = document.querySelectorAll(`[data-family-member-${familyId}]`);
            const isHidden = allMembers[0]?.style.display === 'none';

            allMembers.forEach(m => m.style.display = isHidden ? '' : 'none');
            chevron.textContent = isHidden ? String.fromCharCode(9660) : String.fromCharCode(9658);
          };
        } else {
          // Hide additional rows by default
          row.setAttribute(`data-family-member-${`fam-${inv.id}`}`, 'true');
          row.style.display = 'none';
        }

        rows.push(row);
      });
    });
  }

  if (!rows.length) {
    host.append(el('p', { class: 'empty',
      text: INVITES.length ? 'Nothing matches that.' : 'No guests yet — add the first household above.' }));
    return;
  }
  host.append(table(['Wedding Couple', 'Code', 'Guest', 'RSVP', 'Meal', 'Dietary', ''], rows));
}

function statusPill(s) {
  return el('span', {
    class: `pill pill--${s === 'attending' ? 'yes' : s === 'declined' ? 'no' : 'wait'}`,
    text:  s === 'attending' ? 'Coming' : s === 'declined' ? 'Declined' : 'No reply'
  });
}

function guestViewRow(inv, g, i) {
  return el('tr', {},
    el('td', {}, i === 0 ? el('strong', { text: inv.household_name }) : ''),
    el('td', {}, i === 0 ? el('span', { class: 'code', text: inv.invite_code }) : ''),
    el('td', { text: g.full_name + (g.is_child ? ' (child)' : '') }),
    el('td', {}, statusPill(g.rsvp_status)),
    el('td', { class: 'muted', text: g.meal_choice || '—' }),
    el('td', { class: 'muted', text: g.dietary || '—' }),
    el('td', {}, el('div', { class: 'row' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Edit',
        onclick: () => { EDITING = g.id; renderGuestTable(); } }),
      i === 0 && inv.household_name !== `${W.partner_a} & ${W.partner_b}`
        ? el('button', { class: 'btn btn--danger btn--sm', type: 'button',
            text: 'Remove', onclick: () => removeInvite(inv) })
        : ''))
  );
}

/** Inline editor: fix a name, correct a child flag, or take an RSVP by phone. */
function guestEditRow(inv, g, i) {
  const name = el('input', { class: 'in', value: g.full_name, style: 'min-width:9rem' });
  const child = el('input', { type: 'checkbox', checked: g.is_child,
                              style: 'width:1rem;height:1rem;accent-color:var(--accent)' });

  const status = el('select', { class: 'sel' },
    ...[['pending', 'No reply'], ['attending', 'Coming'], ['declined', 'Declined']]
      .map(([v, t]) => el('option', { value: v, text: t, selected: g.rsvp_status === v })));

  const meal = el('select', { class: 'sel' });
  const rebuildMeal = () => {
    const list = (child.checked && (W.child_meal_options || []).length)
      ? W.child_meal_options : (W.meal_options || []);
    const current = meal.value || g.meal_choice || '';
    meal.innerHTML = '';
    meal.append(el('option', { value: '', text: '—' }));
    list.forEach(m => meal.append(el('option', { value: m, text: m, selected: current === m })));
  };
  rebuildMeal();
  child.addEventListener('change', rebuildMeal);

  const diet = el('input', { class: 'in', value: g.dietary || '', style: 'min-width:8rem' });

  const save = async () => {
    const patch = {
      full_name:   name.value.trim() || g.full_name,
      is_child:    child.checked,
      rsvp_status: status.value,
      meal_choice: meal.value || null,
      dietary:     diet.value.trim() || null
    };
    const { error } = await sb.from('guests').update(patch).eq('id', g.id);
    if (error) return toast(error.message, 'error');
    Object.assign(g, patch);
    EDITING = null;
    renderGuestTable();
    renderOverview();
    toast('Guest updated.', 'success');
  };

  const del = async () => {
    if (!confirm(`Remove ${g.full_name}?`)) return;
    const { error } = await sb.from('guests').delete().eq('id', g.id);
    if (error) return toast(error.message, 'error');
    EDITING = null;
    await loadGuests();
    renderGuestTable();
    renderOverview();
    toast('Guest removed.', 'success');
  };

  return el('tr', { style: 'background:var(--accent-soft)' },
    el('td', {}, i === 0 ? el('strong', { text: inv.household_name }) : ''),
    el('td', {}, i === 0 ? el('span', { class: 'code', text: inv.invite_code }) : ''),
    el('td', {}, name,
      el('label', { style: 'display:flex;gap:.4rem;align-items:center;margin-top:.45rem;font-size:.82rem;cursor:pointer' },
        child, 'Child')),
    el('td', {}, status),
    el('td', {}, meal),
    el('td', {}, diet),
    el('td', {}, el('div', { class: 'row' },
      el('button', { class: 'btn btn--sm', type: 'button', text: 'Save', onclick: save }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Cancel',
        onclick: () => { EDITING = null; renderGuestTable(); } }),
      el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Remove',
        onclick: del })))
  );
}

async function removeInvite(inv) {
  // Prevent removing couple's invite
  if (inv.household_name === `${W.partner_a} & ${W.partner_b}`) {
    toast('Cannot remove the couple from the guest list', 'error');
    return;
  }

  // Check if it's a family group (multiple guests or household name doesn't match)
  const invGuests = GUESTS.filter(g => g.invite_id === inv.id);
  const isFamily = invGuests.length > 1 || invGuests.some(g => g.full_name !== inv.household_name);
  const type = isFamily ? 'family group' : 'guest invite';

  if (!confirm(`Remove ${inv.household_name} ${type}? This cannot be undone.`)) return;

  const { error } = await sb.from('invites').delete().eq('id', inv.id);
  if (error) return toast(error.message, 'error');
  await loadGuests();
  renderOverview();
  toast(`${type} removed.`, 'success');
}

function makeCode(name) {
  const base = name.replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase() || 'INV';
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function addHousehold(household, namesRaw, email, invitedTo, code) {
  const names = namesRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) throw new Error('Add at least one guest.');

  const { data: inv, error } = await sb.from('invites').insert({
    wedding_id: W.id, household_name: household,
    invite_code: (code || makeCode(household)).toUpperCase(),
    email: email || null, invited_to: invitedTo || 'all'
  }).select().single();
  if (error) throw error;

  const rows = names.map(n => {
    const isChild = /\(child\)/i.test(n);
    const clean = n.replace(/\(child\)/ig, '').trim();
    return {
      wedding_id: W.id, invite_id: inv.id,
      full_name: clean || 'Guest',
      is_child: isChild,
      is_plus_one: /^guest$/i.test(clean)
    };
  });
  const { error: gErr } = await sb.from('guests').insert(rows);
  if (gErr) throw gErr;
  return inv;
}

// ---------------------------------------------------------------- photos ---
function renderPhotos() {
  const pending  = PHOTOS.filter(p => p.status === 'pending');
  const approved = PHOTOS.filter(p => p.status === 'approved');

  $('#pendingCount').textContent = pending.length ? `(${pending.length})` : '';
  $('#approvedCount').textContent = approved.length ? `(${approved.length})` : '';

  const draw = (host, list, isPending) => {
    host.innerHTML = '';
    if (!list.length) {
      host.append(el('p', { class: 'empty', style: 'grid-column:1/-1',
        text: isPending ? 'Nothing waiting.' : 'No photos in the album yet.' }));
      return;
    }
    list.forEach(p => {
      const card = el('div', { class: 'ph' },
        el('img', { src: publicPhotoUrl(p.storage_path), loading: 'lazy', alt: p.caption || '' }),
        el('div', { class: 'ph__meta',
          text: [p.uploader_name || (p.uploader_type === 'guest' ? 'A guest' : 'You'),
                 p.caption].filter(Boolean).join(' · ') })
      );
      const acts = el('div', { class: 'ph__acts' });
      if (isPending) {
        acts.append(el('button', { class: 'btn btn--sm', type: 'button', text: 'Approve',
          onclick: () => setPhoto(p, 'approved') }));
      }
      acts.append(el('button', { class: 'btn btn--danger btn--sm', type: 'button',
        text: isPending ? 'Reject' : 'Remove', onclick: () => deletePhoto(p) }));
      if (!isPending) {
        acts.append(el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy URL',
          onclick: () => { navigator.clipboard.writeText(publicPhotoUrl(p.storage_path));
                           toast('Address copied.', 'success'); } }));
      }
      card.append(acts);
      host.append(card);
    });
  };

  draw($('#pendingPhotos'), pending, true);
  draw($('#approvedPhotos'), approved, false);
}

async function setPhoto(p, status) {
  const { error } = await sb.from('photos').update({ status }).eq('id', p.id);
  if (error) return toast(error.message, 'error');
  p.status = status;
  renderPhotos();
}

async function deletePhoto(p) {
  if (!confirm('Delete this photo permanently?')) return;
  await sb.storage.from('wedding-photos').remove([p.storage_path]);
  const { error } = await sb.from('photos').delete().eq('id', p.id);
  if (error) return toast(error.message, 'error');
  PHOTOS = PHOTOS.filter(x => x.id !== p.id);
  renderPhotos();
  toast('Deleted.', 'success');
}

async function uploadOfficial(files) {
  const list = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  const state = $('#adminUploadState');
  let done = 0;

  for (const f of list) {
    state.textContent = `Uploading ${done + 1} of ${list.length}…`;
    try {
      const file = await downscaleImage(f, 2600, 0.85);
      const path = `official/${W.id}/${randomName('jpg')}`;
      const { error: upErr } = await sb.storage.from('wedding-photos')
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error } = await sb.from('photos').insert({
        wedding_id: W.id, storage_path: path,
        uploader_type: isStaff() ? 'venue' : 'couple', status: 'approved'
      });
      if (error) throw error;
      done++;
    } catch (err) {
      console.error(err);
      toast(`${f.name} failed to upload.`, 'error');
    }
  }
  state.textContent = done ? `${done} photo(s) added to the album.` : '';
  await loadPhotos();
}

// --------------------------------------------------------------- content ---
function renderSchedule(items) {
  const host = $('#scheduleList');
  host.innerHTML = '';
  if (!items.length) {
    host.append(el('p', { class: 'empty', text: 'No timings added yet.' }));
    return;
  }
  host.append(table(['Time', 'What', 'Detail', ''], items.map(it =>
    el('tr', {},
      el('td', { text: it.time_label }),
      el('td', { text: it.title }),
      el('td', { class: 'muted', text: it.description || '—' }),
      el('td', {}, el('button', {
        class: 'btn btn--danger btn--sm', type: 'button', text: 'Remove',
        onclick: async () => {
          await sb.from('schedule_items').delete().eq('id', it.id);
          loadContent();
        }
      }))))));
}

function renderInfo(blocks) {
  const host = $('#infoList');
  host.innerHTML = '';
  if (!blocks.length) {
    host.append(el('p', { class: 'empty', text: 'No cards yet.' }));
    return;
  }
  host.append(table(['Title', 'Details', 'Link', ''], blocks.map(b =>
    el('tr', {},
      el('td', { text: b.title }),
      el('td', { class: 'muted', text: (b.body || '').slice(0, 90) }),
      el('td', { class: 'muted', text: b.link_url || '—' }),
      el('td', {}, el('button', {
        class: 'btn btn--danger btn--sm', type: 'button', text: 'Remove',
        onclick: async () => {
          await sb.from('info_blocks').delete().eq('id', b.id);
          loadContent();
        }
      }))))));
}

// -------------------------------------------------------------- settings ---

/**
 * The venue types its address, phone and parking in once, on its own settings
 * page. Every wedding it hosts then inherits those details rather than asking
 * each couple to retype what the venue already knows.
 */
async function loadWeddingVenue() {
  WVENUE = null;
  if (!W?.venue_id) return;
  const cached = VENUES.find(v => v.id === W.venue_id);
  if (cached) { WVENUE = cached; return; }
  const { data } = await sb.from('venues').select('*').eq('id', W.venue_id).single();
  WVENUE = data || null;
}

function fillSettings() {
  $('#pa').value = W.partner_a || '';
  $('#pb').value = W.partner_b || '';
  $('#wdate').value = W.wedding_date || '';
  $('#wtheme').value = W.theme || 'ivory-sage';
  $('#wintro').value = W.intro || '';
  $('#whero').value = W.hero_image_url || '';
  $('#wstory').value = W.story || '';
  // Fall back to the venue's own details so a wedding that has never had these
  // filled in still shows where it is happening. Anything typed here overrides
  // the venue — useful when a ceremony is held somewhere else.
  $('#wloc').value = W.location_name || WVENUE?.name || '';
  $('#wtime').value = W.ceremony_time || '';
  $('#waddr').value = W.location_address || WVENUE?.address || '';
  $('#wmaps').value = W.location_maps_url || WVENUE?.location_maps_url || '';
  $('#wdeadline').value = W.rsvp_deadline || '';
  $('#wmeals').value = (W.meal_options || []).join(', ');
  $('#wchildmeals').value = (W.child_meal_options || []).join(', ');
  fillMenuPicker();
  $('#wrsvpopen').checked = !!W.rsvp_open;
  $('#wnamelookup').checked = !!W.rsvp_name_lookup;
  $('#wcomplete').checked = !!W.wedding_complete;
  $('#wclosing').value = W.closing_message || '';
  $('#wstatus').value = W.status || 'draft';
  $('#wslug').value = W.slug || '';
  $('#wdomain').value = W.custom_domain || '';
  $('#slugPreview').textContent = siteUrl();

  // Publishing (status, web address, domain) is the venue's call, not the
  // couple's — "we unpublished our own site by accident" is not a support
  // call worth having. Also enforced by a trigger in the database.
  $('#publishPanel').classList.toggle('hide', !isStaff());
}

let MENU_PICKER_READY = false;

// The venue writes its set menus up whenever it gets round to it — often after
// the wedding is already in the system. Offering the menu only on the new-wedding
// form left those weddings with no way to ever pick one up.
async function fillMenuPicker() {
  MENU_PICKER_READY = false;
  const sel = $('#wmenu');
  sel.innerHTML = '';
  sel.append(el('option', { value: '', text: 'Not using a set menu' }));

  const { data: menus, error } = await sb.from('venue_menus')
    .select('id, name').eq('venue_id', W.venue_id).order('created_at');

  if (error) {
    toast('Could not load the venue menus: ' + error.message, 'error');
    return;
  }

  (menus || []).forEach(m => sel.append(el('option', { value: m.id, text: m.name })));
  sel.value = W.venue_menu_id || '';

  // Only let Save write this field if the picker is actually showing the truth.
  // A failed load, or a menu this account can't read, would otherwise look like
  // "no set menu" and quietly detach the one the wedding already has.
  MENU_PICKER_READY = sel.value === (W.venue_menu_id || '');

  // Say "there aren't any yet" out loud. Hiding the control when the list came
  // back empty made a missing menu and a missing feature look identical, which
  // is no help to anyone wondering where their menu went.
  sel.disabled = !(menus || []).length;
  $('#wmenuHint').textContent = (menus || []).length
    ? "One of your venue's set menus. Pick one and that is what guests are offered."
    : 'No set menus found for this venue yet — create them under Venue settings, then come back here.';
  reflectMenuChoice();
}

// A set menu overrides whatever is typed below — that is what the database does,
// so say so rather than letting someone type options that quietly do nothing.
function reflectMenuChoice() {
  const usingMenu = !!$('#wmenu').value;
  $('#wmeals').disabled = usingMenu;
  $('#wchildmeals').disabled = usingMenu;
  $('#wmealsHint').textContent = usingMenu
    ? 'The set menu above is what guests are offered. Choose "Not using a set menu" to type your own.'
    : 'Comma separated. Leave blank to skip the question.';
}

async function saveSettings(e) {
  e.preventDefault();
  const btn = $('#saveSettings');
  btn.disabled = true; btn.textContent = 'Saving…';

  const patch = {
    partner_a: $('#pa').value.trim(),
    partner_b: $('#pb').value.trim(),
    wedding_date: $('#wdate').value,
    theme: $('#wtheme').value,
    intro: $('#wintro').value.trim() || null,
    hero_image_url: $('#whero').value.trim() || null,
    story: $('#wstory').value.trim() || null,
    location_name: $('#wloc').value.trim() || null,
    ceremony_time: $('#wtime').value.trim() || null,
    location_address: $('#waddr').value.trim() || null,
    location_maps_url: $('#wmaps').value.trim() || null,
    rsvp_deadline: $('#wdeadline').value || null,
    meal_options: $('#wmeals').value.split(',').map(s => s.trim()).filter(Boolean),
    child_meal_options: $('#wchildmeals').value.split(',').map(s => s.trim()).filter(Boolean),
    rsvp_open: $('#wrsvpopen').checked,
    rsvp_name_lookup: $('#wnamelookup').checked,
    wedding_complete: $('#wcomplete').checked,
    closing_message: $('#wclosing').value.trim() || null
  };

  if (MENU_PICKER_READY) patch.venue_menu_id = $('#wmenu').value || null;

  // Only venue staff and above may touch publishing fields.
  if (isStaff()) {
    patch.status = $('#wstatus').value;
    patch.slug = slugify($('#wslug').value);
    patch.custom_domain = $('#wdomain').value.trim().toLowerCase()
                            .replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
  }

  const { data, error } = await sb.from('weddings')
    .update(patch).eq('id', W.id).select().single();

  btn.disabled = false; btn.textContent = 'Save changes';
  if (error) return toast(error.message, 'error');

  Object.assign(W, data);
  WEDDINGS = WEDDINGS.map(w => w.id === W.id ? W : w);
  fillSettings();
  renderOverview();
  toast('Saved.', 'success');
}

// ------------------------------------------------------------------ venue --
async function loadAccess() {
  const host = $('#accessList');
  if (!host) return;
  const { data } = await sb.rpc('list_wedding_access', { p_wedding: W.id });
  host.innerHTML = '';
  const list = data || [];
  if (!list.length) {
    host.append(el('p', { class: 'empty', text: 'Nobody linked yet.' }));
    return;
  }
  host.append(table(['Email', 'Role', 'Status', ''], list.map(m =>
    el('tr', {},
      el('td', { text: m.email }),
      el('td', { class: 'muted', text: m.role }),
      el('td', {}, m.pending
        ? el('span', { class: 'pill pill--wait', text: 'Invited' })
        : el('span', { class: 'pill pill--yes', text: 'Active' })),
      el('td', {}, m.role === 'couple'
        ? el('button', { class: 'btn btn--danger btn--sm', type: 'button',
            text: m.pending ? 'Cancel' : 'Unlink',
            onclick: async () => {
              const { error } = await sb.rpc('revoke_wedding_access', { p_membership: m.id });
              if (error) return toast(error.message, 'error');
              loadAccess();
              toast(m.pending ? 'Invitation cancelled.' : 'Access removed.', 'success');
            } })
        : '')))));
}

// -------------------------------------------------------------- csv utils --
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const head = ['Household', 'Code', 'Email', 'Invited to', 'Guest', 'Child',
                'RSVP', 'Meal', 'Dietary', 'Replied'];
  const lines = [head.join(',')];

  INVITES.forEach(inv => {
    GUESTS.filter(g => g.invite_id === inv.id).forEach(g => {
      lines.push([inv.household_name, inv.invite_code, inv.email || '', inv.invited_to,
                  g.full_name, g.is_child ? 'yes' : '', g.rsvp_status,
                  g.meal_choice || '', g.dietary || '',
                  inv.responded_at ? inv.responded_at.slice(0, 10) : '']
                 .map(csvEscape).join(','));
    });
  });

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', {
    href: URL.createObjectURL(blob),
    download: `${W.slug}-guest-list-${new Date().toISOString().slice(0, 10)}.csv`
  });
  document.body.append(a); a.click(); a.remove();
}

/** Minimal RFC-4180 parser — handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

async function importCsv(file) {
  const text = (await file.text()).replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('That file looks empty.', 'error');

  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i > -1) return i; }
    return -1;
  };
  const cHouse = col('household', 'addressed to', 'name');
  const cGuests = col('guests', 'guest names', 'names');
  const cEmail = col('email', 'email address');
  const cCode = col('code', 'invite code', 'invitation code');
  const cInvited = col('invited to', 'invited');

  if (cHouse < 0 || cGuests < 0) {
    return toast('Needs at least a "Household" and a "Guests" column.', 'error');
  }

  let ok = 0, failed = 0;
  for (const r of rows.slice(1)) {
    try {
      await addHousehold(
        r[cHouse]?.trim(), r[cGuests]?.trim(),
        cEmail > -1 ? r[cEmail]?.trim() : '',
        cInvited > -1 ? r[cInvited]?.trim().toLowerCase() : 'all',
        cCode > -1 ? r[cCode]?.trim() : ''
      );
      ok++;
    } catch (err) { console.error(err); failed++; }
  }

  await loadGuests();
  renderOverview();
  toast(`Imported ${ok} household(s).` + (failed ? ` ${failed} failed.` : ''),
        failed ? 'error' : 'success');
}

// -------------------------------------------------------------- wire-up ----
function wireEverything() {
  if (wireEverything.done) return;
  wireEverything.done = true;

  // guests
  $('#addInvite').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await addHousehold($('#hh').value.trim(), $('#hhGuests').value.trim(),
                         $('#hhEmail').value.trim(), $('#hhInvited').value,
                         $('#hhCode').value.trim());
      e.target.reset();
      await loadGuests();
      renderOverview();
      toast('Household added.', 'success');
    } catch (err) { toast(err.message || 'Could not add that.', 'error'); }
  });
  $('#guestSearch').addEventListener('input', renderGuestTable);
  $('#guestFilter').addEventListener('change', renderGuestTable);
  $('#exportCsv').onclick = exportCsv;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').addEventListener('change', e => {
    if (e.target.files[0]) importCsv(e.target.files[0]);
    e.target.value = '';
  });

  // photos
  const toggle = async (field, node) => {
    const { error } = await sb.from('weddings')
      .update({ [field]: node.checked }).eq('id', W.id);
    if (error) { node.checked = !node.checked; return toast(error.message, 'error'); }
    W[field] = node.checked;
    toast('Saved.', 'success');
  };
  $('#galleryVisible').onchange = e => toggle('gallery_visible', e.target);
  $('#guestUpload').onchange = e => toggle('guest_upload_enabled', e.target);

  const drop = $('#adminDrop'), files = $('#adminFiles');
  drop.onclick = () => files.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); files.click(); } };
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => uploadOfficial(e.dataTransfer.files));
  files.addEventListener('change', e => { uploadOfficial(e.target.files); e.target.value = ''; });

  $('#approveAll').onclick = async () => {
    const pending = PHOTOS.filter(p => p.status === 'pending');
    if (!pending.length) return;
    if (!confirm(`Approve all ${pending.length} photos?`)) return;
    const { error } = await sb.from('photos').update({ status: 'approved' })
      .eq('wedding_id', W.id).eq('status', 'pending');
    if (error) return toast(error.message, 'error');
    await loadPhotos();
    toast('All approved.', 'success');
  };

  $('#backHome').onclick = () => renderHome();
  $('#homeNew').onclick = () => startNewWedding();
  $('#homeNewEmpty').onclick = () => startNewWedding();
  $('#cancelCreate').onclick = () => {
    const form = $('#homeCreateForm');
    if (form) form.hidden = true;
    $('#newWedding').reset();
  };

  $('#qrBtn').onclick = showQr;

  $('#copyUploadLink').onclick = () => {
    navigator.clipboard.writeText(uploadUrl());
    toast('Upload link copied.', 'success');
  };

  $('#newKeyBtn').onclick = async () => {
    if (!confirm('Generate a new photo code?\n\nAny QR codes already printed, and '
               + 'any link you have shared, will stop working.')) return;
    const { data, error } = await sb.rpc('regenerate_upload_key', { p_wedding: W.id });
    if (error) return toast(error.message, 'error');
    W.upload_key = data.key;
    $('#uploadKey').textContent = data.key;
    $('#uploadUrl').textContent = uploadUrl();
    toast('New code created — reprint the QR.', 'success');
  };
  $('#qrClose').onclick = () => $('#qrDialog').close();
  $('#qrPrint').onclick = () => window.print();

  // content
  $('#addSchedule').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.from('schedule_items').insert({
      wedding_id: W.id, time_label: $('#schTime').value.trim(),
      title: $('#schTitle').value.trim(),
      description: $('#schDesc').value.trim() || null,
      sort_order: Date.now() % 100000
    });
    if (error) return toast(error.message, 'error');
    e.target.reset(); loadContent();
  });

  $('#addInfo').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.from('info_blocks').insert({
      wedding_id: W.id, title: $('#infTitle').value.trim(),
      body: $('#infBody').value.trim(),
      link_url: $('#infLink').value.trim() || null,
      link_label: $('#infLink').value.trim() ? 'Find out more' : null,
      sort_order: Date.now() % 100000
    });
    if (error) return toast(error.message, 'error');
    e.target.reset(); loadContent();
  });

  // settings
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#wmenu').addEventListener('change', reflectMenuChoice);

  $('#deleteWedding').onclick = async () => {
    const name = `${W.partner_a} & ${W.partner_b}`;
    if (!confirm(`Are you sure you want to delete "${name}"?\n\nThis cannot be undone. All guests, photos, and RSVP data will be permanently deleted.`)) return;

    const btn = $('#deleteWedding');
    btn.disabled = true;
    btn.textContent = 'Deleting…';

    const { error } = await sb.from('weddings').delete().eq('id', W.id);

    btn.disabled = false;
    btn.textContent = 'Delete wedding';

    if (error) {
      toast('Could not delete: ' + error.message, 'error');
    } else {
      toast('Wedding deleted', 'success');
      WEDDINGS = WEDDINGS.filter(w => w.id !== W.id);
      renderHome();
    }
  };

  // venue
  // Keep the web address a legal slug as it's typed, and fill it in from the
  // names until the user edits it themselves.
  const nslug = $('#nslug');
  let slugTouched = false;

  const showSlugPreview = () => {
    $('#newSlugPreview').textContent = nslug.value
      ? `${location.origin}/w/${nslug.value}`
      : 'Fill in the names above and this fills itself in.';
  };
  const autoSlug = () => {
    if (slugTouched) return;
    const a = $('#npa').value.trim(), b = $('#npb').value.trim();
    nslug.value = (a && b) ? slugify(`${a} and ${b}`) : slugify(a || b);
    showSlugPreview();
  };

  $('#npa').addEventListener('input', autoSlug);
  $('#npb').addEventListener('input', autoSlug);
  nslug.addEventListener('input', () => {
    slugTouched = nslug.value.trim() !== '';
    const pos = nslug.selectionStart;
    nslug.value = slugify(nslug.value, true);
    nslug.setSelectionRange(pos, pos);
    showSlugPreview();
  });
  showSlugPreview();

  // Load menus when venue is selected
  $('#nvenue').addEventListener('change', async () => {
    const venueId = $('#nvenue').value;
    const menuSelect = $('#nmenu');
    menuSelect.innerHTML = '<option value="">No menu assigned yet</option>';

    if (venueId) {
      const { data: menus, error } = await sb.from('venue_menus').select('*')
        .eq('venue_id', venueId).order('created_at');
      if (error) {
        console.error('Error loading menus:', error);
        toast('Could not load menus: ' + error.message, 'error');
      } else {
        (menus || []).forEach(m => {
          menuSelect.append(el('option', { value: m.id, text: m.name }));
        });
      }
    }
  });

  $('#newWedding').addEventListener('submit', async e => {
    e.preventDefault();
    const menuId = $('#nmenu').value || null;
    const { data, error } = await sb.from('weddings').insert({
      venue_id: $('#nvenue').value,
      partner_a: $('#npa').value.trim(), partner_b: $('#npb').value.trim(),
      wedding_date: $('#ndate').value,
      slug: slugify($('#nslug').value),
      status: 'draft',
      venue_menu_id: menuId
    }).select().single();
    if (error) return toast(error.message, 'error');

    // Auto-add couple as guests + create their invite
    const coupleNames = `${data.partner_a} & ${data.partner_b}`;
    const { data: coupleInvite, error: invError } = await sb
      .from('invites')
      .insert({
        wedding_id: data.id,
        household_name: coupleNames,
        invite_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
        invited_to: 'all'
      })
      .select('id')
      .single();

    if (coupleInvite) {
      const { error: guestError } = await sb.from('guests').insert([
        {
          invite_id: coupleInvite.id,
          wedding_id: data.id,
          full_name: data.partner_a,
          rsvp_status: 'attending'
        },
        {
          invite_id: coupleInvite.id,
          wedding_id: data.id,
          full_name: data.partner_b,
          rsvp_status: 'attending'
        }
      ]);
      if (guestError) console.error('Guest insert error:', guestError);
    }

    WEDDINGS.unshift(data);
    $('#weddingPicker').prepend(el('option', {
      value: data.id,
      text: `${data.partner_a} & ${data.partner_b} — ${formatDate(data.wedding_date, 'short')} (draft)`
    }));
    e.target.reset();
    const form = $('#homeCreateForm');
    if (form) form.hidden = true;

    await openWedding(data.id);
    switchTab('overview');
    toast('Wedding created! The couple is ready to log in and manage their guests.', 'success');
  });

  $('#grantForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!W) return toast('No wedding selected.', 'error');

    const email = $('#grantEmail').value.trim();
    const btn = $('#grantBtn');
    const hint = $('#grantHint');

    btn.disabled = true; btn.textContent = 'Sending…';
    hint.textContent = ''; hint.style.color = '';

    // Record the invitation first. If they already have an account this grants
    // access immediately; if not it waits until they first sign in.
    const { data, error } = await sb.rpc('invite_couple', {
      p_wedding: W.id, p_email: email
    });
    if (error) {
      btn.disabled = false; btn.textContent = 'Send invitation';
      return toast(error.message, 'error');
    }

    const { error: mailErr } = await sendInviteEmail(email, `${location.origin}/admin/`);

    btn.disabled = false; btn.textContent = 'Send invitation';
    $('#grantEmail').value = '';
    await loadAccess();

    if (mailErr) {
      hint.style.color = 'var(--danger)';
      hint.textContent = `Access recorded, but the email failed: ${mailErr.message}`;
      toast('Invitation recorded — email failed to send.', 'error');
    } else {
      hint.textContent = data.existing
        ? 'They already had an account. Access granted and a sign-in link sent.'
        : 'Invitation sent. They get access automatically when they sign in.';
      toast('Invitation sent.', 'success');
    }
  });
}

async function showQr() {
  const url = uploadUrl();
  $('#qrUrl').textContent = url;
  const holder = $('#qrHolder');
  holder.innerHTML = '';
  try {
    const QR = await import('https://esm.sh/qrcode@1.5.4');
    const canvas = el('canvas');
    holder.append(canvas);
    await QR.toCanvas(canvas, url, { width: 260, margin: 1,
                                     color: { dark: '#111111', light: '#ffffff' } });
  } catch {
    holder.append(el('p', { class: 'hint',
      text: 'Could not draw the QR code. The link above still works.' }));
  }
  $('#qrDialog').showModal();
}
