// ---------------------------------------------------------------------------
//  Guest-facing wedding site.
// ---------------------------------------------------------------------------
import { sb, cfg, resolveSlug, publicPhotoUrl, $, el,
         formatDate, daysUntil, toast } from './app.js?v=11';

/** /w/<slug>/photos shows the album on its own, without the rest of the site. */
const PHOTOS_VIEW = (() => {
  const seg = location.pathname.split('/').filter(Boolean);
  if (seg[0] === 'w' && (seg[2] || '').toLowerCase() === 'photos') return true;
  return new URL(location.href).searchParams.get('view') === 'photos';
})();

let SLUG = '';
let WEDDING = null;
let COMPLETE = false;            // the couple has marked the day as done
let INVITE = null;         // { id, token, household_name, ... }
let GUESTS = [];
let MEALS = [];
let CHILD_MEALS = [];      // empty means children get the adult menu
let PHOTOS = [];

// Stamped so it's possible to tell which build a browser is actually running.
const BUILD = '2026-08-18-c';
window.__WEDDING_BUILD = BUILD;

// ------------------------------------------------------------------- boot --
(async function boot() {
  try {
    await start();
  } catch (err) {
    // Silent failures here look like "the page just didn't update", which has
    // already cost an evening. Make them loud.
    console.error('[wedding.js]', BUILD, err);
    window.__WEDDING_ERROR = String(err && err.stack || err);
  }
})();

async function start() {
  SLUG = await resolveSlug();
  if (!SLUG) return fail('No wedding specified.',
    'This link looks incomplete. Please check the address on your invitation.');

  const { data, error } = await sb.rpc('wedding_public', { p_slug: SLUG });
  if (error || !data) return fail('Not found',
    'We couldn’t find this wedding. It may not have been published yet.');

  WEDDING = data.wedding;
  MEALS = WEDDING.meal_options || [];
  CHILD_MEALS = WEDDING.child_meal_options || [];

  document.documentElement.dataset.theme = WEDDING.theme || 'ivory-sage';
  COMPLETE = !!WEDDING.wedding_complete;

  if (WEDDING.status !== 'live') showDraftBanner();
  if (PHOTOS_VIEW) setUpPhotosView();

  renderHero();

  if (!PHOTOS_VIEW && COMPLETE) {
    renderClosing();
  } else if (!PHOTOS_VIEW) {
    renderStory();
    renderSchedule(data.schedule || []);
    renderInfo(data.info || []);
    renderRsvpIntro();
  }

  renderFooter(data.venue);
  buildNav();
  await loadGallery();
  if (!PHOTOS_VIEW && !COMPLETE) wireRsvp();
  wireLightbox();
  wireReveal();
  wireStickyNav();
}

function fail(title, body) {
  $('#heroNames').textContent = title;
  $('#heroMeta').textContent = body;
  $('#rsvp').hidden = true;
}

/** Strip the site back to just the album, with a way home. */
function setUpPhotosView() {
  ['#story', '#schedule', '#details', '#rsvp'].forEach(sel => $(sel)?.remove());
  $('.hero').classList.add('hero--compact');
  $('#galleryBackWrap').hidden = false;
  $('#galleryBackLink').href = `/w/${SLUG}`;
}

/**
 * The day is done. Everything practical — RSVP, timings, parking, menus — has
 * served its purpose and is now clutter. What's left is a thank-you and the
 * album, at the same address the invitation used.
 */
function renderClosing() {
  ['#story', '#schedule', '#details', '#rsvp'].forEach(sel => $(sel)?.remove());

  const message = (WEDDING.closing_message || '').trim()
    || 'Thank you for celebrating with us. The photographs from the day are below.';

  const box = $('#closingBody');
  message.split(/\n{2,}/).forEach(p => box.append(el('p', { text: p.trim() })));
  $('#closing').hidden = false;

  $('#countdown').hidden = true;

  if (WEDDING.gallery_visible) {
    $('#heroCtaWrap').hidden = false;
    $('#heroCta').href = `/w/${SLUG}/photos`;
  }
}

/** Only reachable by someone who can manage this wedding — see wedding_public(). */
function showDraftBanner() {
  document.body.prepend(el('div', {
    role: 'status',
    style: 'position:sticky;top:0;z-index:60;background:#8a6d1f;color:#fff;'
         + 'text-align:center;padding:.6rem 1rem;font-size:.85rem;letter-spacing:.04em'
  }, 'Preview — this site is a draft. Guests can’t see it until you publish it.'));
}

// ----------------------------------------------------------------- render --
function names() { return `${WEDDING.partner_a} & ${WEDDING.partner_b}`; }

function renderHero() {
  document.title = PHOTOS_VIEW
    ? `Photographs — ${names()}`
    : `${names()} — ${formatDate(WEDDING.wedding_date, 'short')}`;

  const hero = $('.hero');
  if (WEDDING.hero_image_url) {
    const img = $('#heroImage');
    img.src = WEDDING.hero_image_url;
    img.hidden = false;
    hero.classList.remove('hero--noimage');
  }

  $('#heroEyebrow').textContent = WEDDING.intro || 'Together with our families';
  $('#heroNames').innerHTML = '';
  $('#heroNames').append(
    WEDDING.partner_a,
    el('span', { class: 'hero__amp', text: 'and' }),
    WEDDING.partner_b
  );

  const meta = $('#heroMeta');
  meta.append(el('span', { text: formatDate(WEDDING.wedding_date) }));
  if (WEDDING.location_name) meta.append(el('span', { text: WEDDING.location_name }));

  const d = daysUntil(WEDDING.wedding_date);
  if (d !== null && d > 0) {
    $('#countdown').hidden = false;
    $('#countdown').textContent = d === 1 ? 'Tomorrow' : `${d} days to go`;
  } else if (d === 0) {
    $('#countdown').hidden = false;
    $('#countdown').textContent = 'Today';
  }
}

function renderStory() {
  if (!WEDDING.story) return;
  const box = $('#storyBody');
  WEDDING.story.split(/\n{2,}/).forEach(p => box.append(el('p', { text: p.trim() })));
  $('#story').hidden = false;
}

function renderSchedule(items) {
  if (!items.length) return;
  const list = $('#timeline');
  items.forEach(it => list.append(
    el('li', { class: 'timeline__item reveal' },
      el('p', { class: 'timeline__time', text: it.time_label }),
      el('h3', { class: 'timeline__title', text: it.title }),
      it.description && el('p', { class: 'timeline__desc', text: it.description })
    )
  ));
  $('#schedule').hidden = false;
}

function renderInfo(blocks) {
  const grid = $('#infoGrid');
  const all = [...blocks];

  // The venue address is always worth a card, even if nobody filled one in.
  if (WEDDING.location_address) {
    all.unshift({
      title: WEDDING.location_name || 'The venue',
      body: WEDDING.location_address,
      link_url: WEDDING.location_maps_url,
      link_label: 'Open in maps'
    });
  }
  if (!all.length) return;

  all.forEach(b => grid.append(
    el('article', { class: 'card reveal' },
      el('h3', { class: 'card__title', text: b.title }),
      el('p', { class: 'card__body', text: b.body }),
      b.link_url && el('a', {
        class: 'card__link', href: b.link_url, target: '_blank', rel: 'noopener noreferrer',
        text: b.link_label || 'Find out more'
      })
    )
  ));
  $('#details').hidden = false;
}

function renderRsvpIntro() {
  if (!WEDDING.rsvp_open) {
    $('#lookupForm').hidden = true;
    $('#rsvpDeadline').textContent = 'RSVPs are now closed. Thank you to everyone who replied.';
    return;
  }
  if (WEDDING.rsvp_deadline) {
    $('#rsvpDeadline').textContent =
      `Kindly reply by ${formatDate(WEDDING.rsvp_deadline)}.`;
  }
}

function renderFooter(venue) {
  $('#footerVenue').textContent = venue?.name || '';
  const line = $('#footerLine');
  line.append(`${names()} · ${formatDate(WEDDING.wedding_date, 'short')}`);

  // When selling direct, the venue *is* the platform — don't credit ourselves
  // twice in the same footer.
  const sellingDirect = (venue?.name || '').trim().toLowerCase()
                      === (cfg.PLATFORM_NAME || '').trim().toLowerCase();

  if (cfg.PLATFORM_NAME && !sellingDirect) {
    line.append(el('br'));
    line.append(el('a', {
      href: cfg.PLATFORM_URL || '#', target: '_blank', rel: 'noopener noreferrer',
      style: 'opacity:.7;font-size:.85em', text: `Made with ${cfg.PLATFORM_NAME}`
    }));
  }
}

function buildNav() {
  const ul = $('#navLinks');

  const photosHref = WEDDING.gallery_visible ? `/w/${SLUG}/photos` : '#gallery';

  const items = PHOTOS_VIEW
    ? [[`/w/${SLUG}`, COMPLETE ? 'Home' : 'Wedding details']]
    : COMPLETE
      // Nothing else left to navigate to once the day is done.
      ? [[photosHref, 'Photographs']]
      : [
          ['#story', 'Our story'],
          ['#schedule', 'The day'],
          ['#details', 'Details'],
          ['#rsvp', 'RSVP'],
          // Once there's an album it gets its own page, not a scroll target.
          [photosHref, 'Photos']
        ];

  items.forEach(([href, label]) => {
    if (href.startsWith('#')) {
      const section = $(href);
      if (!section || section.hidden) return;      // section not on this page
    }
    ul.append(el('li', {}, el('a', { href, text: label })));
  });

  $('#navBrand').textContent = names();
  $('#navBrand').href = PHOTOS_VIEW ? `/w/${SLUG}` : '#top';
  $('#nav').hidden = false;
}

// ---------------------------------------------------------------- gallery --
const PAGE_SIZE = 60;
let ALL_PHOTOS = [];
let OFFICIAL = [], GUEST = [];
const shown = { official: 0, guest: 0 };

const GROUPS = {
  official: { grid: '#gridOfficial', wrap: '#groupOfficial', more: '#moreOfficial' },
  guest:    { grid: '#gridGuest',    wrap: '#groupGuest',    more: '#moreGuest' }
};

async function loadGallery() {
  if (!WEDDING.gallery_visible && !WEDDING.guest_upload_enabled) return;

  if (WEDDING.gallery_visible) {
    const { data } = await sb.from('photos')
      .select('id, storage_path, caption, uploader_name, uploader_type')
      .eq('wedding_id', WEDDING.id).eq('status', 'approved')
      .order('sort_order').order('created_at', { ascending: false })
      .limit(1000);
    ALL_PHOTOS = data || [];
  }

  OFFICIAL = ALL_PHOTOS.filter(p => p.uploader_type !== 'guest');
  GUEST    = ALL_PHOTOS.filter(p => p.uploader_type === 'guest');

  // The lightbox walks the photos in the order the page presents them.
  PHOTOS = [...OFFICIAL, ...GUEST];

  renderGroup('official', OFFICIAL, 0, true);
  renderGroup('guest', GUEST, OFFICIAL.length, true);

  $('#moreOfficial').onclick = () => renderGroup('official', OFFICIAL, 0, false);
  $('#moreGuest').onclick    = () => renderGroup('guest', GUEST, OFFICIAL.length, false);

  if (WEDDING.guest_upload_enabled) {
    $('#galleryUploadWrap').hidden = false;
    $('#galleryUploadLink').href = `/u/${SLUG}`;
  }

  $('#galleryNote').textContent = WEDDING.is_demo
    // Sell the feature without opening our storage to strangers.
    ? 'On a real wedding, guests scan a QR code on their table and add their own '
      + 'photographs here — with the couple approving each one.'
    : !ALL_PHOTOS.length
      ? (WEDDING.guest_upload_enabled
          ? 'Nothing here yet — be the first to add a photograph.'
          : 'The photographs will appear here soon.')
      : (WEDDING.guest_upload_enabled
          ? 'Took something lovely? Add it below — everything is checked before it appears.'
          : 'Click any photograph to see it full size.');

  if (ALL_PHOTOS.length || WEDDING.guest_upload_enabled) $('#gallery').hidden = false;
}

/**
 * One group at a time, in batches — a 400-photo album shouldn't land on a
 * phone all at once. `offset` is where this group starts in the combined
 * PHOTOS array, so lightbox indices stay correct across both groups.
 */
function renderGroup(key, list, offset, reset) {
  const g = GROUPS[key];
  const grid = $(g.grid), wrap = $(g.wrap), moreBtn = $(g.more);

  if (reset) { grid.innerHTML = ''; shown[key] = 0; }

  if (!list.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  list.slice(shown[key], shown[key] + PAGE_SIZE).forEach((p, n) => {
    grid.append(photoTile(p, offset + shown[key] + n));
  });

  shown[key] = Math.min(shown[key] + PAGE_SIZE, list.length);

  const left = list.length - shown[key];
  moreBtn.hidden = left <= 0;
  moreBtn.textContent = `Show ${Math.min(left, PAGE_SIZE)} more of ${left}`;
}

function photoTile(p, index) {
  const btn = el('button', {
    class: 'gallery__item', type: 'button',
    'aria-label': p.caption || 'View photograph',
    onclick: () => openLightbox(index)
  }, el('img', { src: publicPhotoUrl(p.storage_path), loading: 'lazy',
                 decoding: 'async', alt: p.caption || '' }));

  const cap = [p.caption, p.uploader_name && `— ${p.uploader_name}`]
    .filter(Boolean).join(' ');
  if (cap) btn.append(el('span', { class: 'gallery__cap', text: cap }));
  return btn;
}

// --------------------------------------------------------------- lightbox --
let lbIndex = 0;
function openLightbox(i) {
  lbIndex = i;
  const p = PHOTOS[i];
  if (!p) return;
  $('#lbImage').src = publicPhotoUrl(p.storage_path);
  $('#lbImage').alt = p.caption || '';
  $('#lbCap').textContent =
    [p.caption, p.uploader_name && `— ${p.uploader_name}`].filter(Boolean).join(' ');

  // Couples ask for this constantly — let people take a copy.
  const dl = $('#lbDownload');
  dl.href = publicPhotoUrl(p.storage_path);
  dl.setAttribute('download', p.storage_path.split('/').pop() || 'photograph.jpg');
  $('#lightbox').setAttribute('open', '');
  $('#lbClose').focus();
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  $('#lightbox').removeAttribute('open');
  document.body.style.overflow = '';
}
function step(n) { openLightbox((lbIndex + n + PHOTOS.length) % PHOTOS.length); }

function wireLightbox() {
  $('#lbClose').onclick = closeLightbox;
  $('#lbPrev').onclick = () => step(-1);
  $('#lbNext').onclick = () => step(1);
  $('#lightbox').addEventListener('click', e => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
  document.addEventListener('keydown', e => {
    if (!$('#lightbox').hasAttribute('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
}

// ------------------------------------------------------------------- rsvp --
function wireRsvp() {
  $('#lookupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#lookupInput').value.trim();
    if (q.length < 3) return toast('Please type a little more.', 'error');

    const btn = $('#lookupBtn');
    btn.disabled = true; btn.textContent = 'Looking…';

    const { data, error } = await sb.rpc('rsvp_lookup', { p_slug: SLUG, p_query: q });

    btn.disabled = false; btn.textContent = 'Look up my invitation';

    if (error) return toast('Something went wrong. Please try again.', 'error');
    if (!data) {
      $('#lookupHint').textContent =
        'We couldn’t match that. Try the code exactly as printed, or the full name on the envelope.';
      $('#lookupHint').style.color = 'var(--accent)';
      return;
    }

    INVITE = data.invite;
    GUESTS = data.guests || [];
    MEALS = data.wedding?.meal_options || MEALS;
    CHILD_MEALS = data.wedding?.child_meal_options || CHILD_MEALS;

    if (INVITE.responded_at) showDone(true);
    else showForm();
  });

  $('#rsvpBack').onclick = () => {
    INVITE = null;
    $('#rsvpForm').hidden = true;
    $('#lookupForm').hidden = false;
    $('#lookupInput').value = '';
    $('#lookupInput').focus();
  };

  $('#doneEdit').onclick = () => { $('#rsvpDone').hidden = true; showForm(); };

  $('#rsvpForm').addEventListener('submit', submitRsvp);
}

function showForm() {
  $('#lookupForm').hidden = true;
  $('#rsvpDone').hidden = true;
  $('#rsvpForm').hidden = false;
  $('#householdName').textContent = INVITE.household_name;

  if (INVITE.responded_at) {
    const note = $('#rsvpNote');
    note.hidden = false;
    note.textContent = 'You’ve already replied — changing anything below will update your response.';
  }

  $('#songInput').value = INVITE.song_request || '';
  $('#messageInput').value = INVITE.message || '';

  const list = $('#guestList');
  list.innerHTML = '';
  GUESTS.forEach(g => list.append(guestRow(g)));
  $('#rsvpForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function guestRow(g) {
  const row = el('div', { class: 'guest-row', 'data-guest': g.id });

  if (g.is_plus_one) {
    row.append(
      el('label', { class: 'field__label', for: `name-${g.id}` }, 'Your guest’s name'),
      el('input', { class: 'input', id: `name-${g.id}`, 'data-name': '1',
                    value: g.full_name === 'Guest' ? '' : g.full_name,
                    placeholder: 'Who are you bringing?', style: 'margin-bottom:.9rem' })
    );
  } else {
    const heading = el('h4', { class: 'guest-row__name', text: g.full_name });
    // Say so plainly. Otherwise the only clue is that the menu quietly differs.
    if (g.is_child) heading.append(el('span', { class: 'guest-tag', text: 'Child' }));
    row.append(heading);
  }

  const yes = el('label', { class: 'choice__opt' },
    el('input', { type: 'radio', name: `s-${g.id}`, value: 'attending',
                  checked: g.rsvp_status === 'attending' }),
    el('span', { text: 'Joyfully accepts' }));
  const no = el('label', { class: 'choice__opt' },
    el('input', { type: 'radio', name: `s-${g.id}`, value: 'declined',
                  checked: g.rsvp_status === 'declined' }),
    el('span', { text: 'Regretfully declines' }));

  row.append(el('div', { class: 'choice' }, yes, no));

  // Meal + dietary only make sense for someone who's coming.
  const extra = el('div', { class: 'stack', style: 'margin-top:1.25rem',
                            hidden: g.rsvp_status !== 'attending' });

  // Children get their own menu when the couple has set one up.
  const menu = (g.is_child && CHILD_MEALS.length) ? CHILD_MEALS : MEALS;
  if (menu.length) {
    const sel = el('select', { class: 'select', 'data-meal': '1' },
      el('option', { value: '', text: 'Please choose…' }),
      ...menu.map(m => el('option', { value: m, text: m, selected: g.meal_choice === m }))
    );
    extra.append(el('div', { class: 'field', style: 'margin:0' },
      el('label', { class: 'field__label',
                    text: (g.is_child && CHILD_MEALS.length) ? 'Children’s menu' : 'Main course' }),
      sel));
  }
  extra.append(el('div', { class: 'field', style: 'margin:0' },
    el('label', { class: 'field__label', text: 'Dietary requirements' }),
    el('input', { class: 'input', 'data-diet': '1', value: g.dietary || '',
                  placeholder: 'Allergies, vegetarian, vegan…' })));

  row.append(extra);
  row.querySelectorAll('input[type=radio]').forEach(r =>
    r.addEventListener('change', () => { extra.hidden = r.value !== 'attending' || !r.checked; }));

  return row;
}

async function submitRsvp(e) {
  e.preventDefault();
  const rows = Array.from($('#guestList').children);

  const payload = rows.map(row => {
    const id = row.dataset.guest;
    const picked = row.querySelector('input[type=radio]:checked');
    return {
      id,
      rsvp_status: picked ? picked.value : 'pending',
      meal_choice: row.querySelector('[data-meal]')?.value || '',
      dietary: row.querySelector('[data-diet]')?.value || '',
      full_name: row.querySelector('[data-name]')?.value || ''
    };
  });

  if (payload.some(p => p.rsvp_status === 'pending')) {
    return toast('Please answer for everyone on the invitation.', 'error');
  }

  const btn = $('#rsvpSubmit');
  btn.disabled = true; btn.textContent = 'Sending…';

  const { error } = await sb.rpc('rsvp_submit', {
    p_slug: SLUG, p_token: INVITE.token, p_guests: payload,
    p_message: $('#messageInput').value, p_song: $('#songInput').value
  });

  btn.disabled = false; btn.textContent = 'Send our response';

  if (error) return toast(error.message || 'Could not save your response.', 'error');

  GUESTS = GUESTS.map(g => {
    const p = payload.find(x => x.id === g.id);
    return p ? { ...g, rsvp_status: p.rsvp_status, meal_choice: p.meal_choice,
                 dietary: p.dietary, full_name: p.full_name || g.full_name } : g;
  });
  INVITE.responded_at = new Date().toISOString();
  INVITE.song_request = $('#songInput').value;
  INVITE.message = $('#messageInput').value;

  showDone(false);
  toast('Thank you — your response is saved.', 'success');
}

function showDone(existing) {
  $('#lookupForm').hidden = true;
  $('#rsvpForm').hidden = true;
  $('#rsvpDone').hidden = false;

  const coming = GUESTS.filter(g => g.rsvp_status === 'attending');
  $('#doneTitle').textContent = coming.length
    ? (coming.length === 1 ? 'We can’t wait to see you' : 'We can’t wait to see you all')
    : 'You’ll be missed';

  $('#doneBody').textContent = coming.length
    ? `${listNames(coming)} ${coming.length === 1 ? 'is' : 'are'} down as attending on `
      + `${formatDate(WEDDING.wedding_date)}.`
      + (existing ? ' This was saved earlier — you can still change it.' : '')
    : 'Thank you for letting us know. If anything changes, just come back to this page.';

  $('#rsvpDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function listNames(gs) {
  const n = gs.map(g => g.full_name);
  if (n.length === 1) return n[0];
  return `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

// ------------------------------------------------------------- behaviours --
function wireReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(n => n.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('.reveal').forEach((n, i) => {
    n.style.transitionDelay = `${Math.min(i % 6, 5) * 70}ms`;
    io.observe(n);
  });
}

function wireStickyNav() {
  const nav = $('#nav');
  const io = new IntersectionObserver(
    ([en]) => nav.classList.toggle('is-stuck', !en.isIntersecting),
    { rootMargin: '-80px 0px 0px 0px' });
  io.observe($('#top'));
}
