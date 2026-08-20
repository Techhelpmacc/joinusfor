import { sb, $, $$, el, toast } from './app.js?v=20';

let USER = null, VENUE = null, EDITING_MENU_ID = null;

(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    document.getElementById('loginView').hidden = false;
    setupLoginForm();
    return;
  }

  await loadVenue(session.user);
  document.getElementById('venueView').hidden = false;
  document.getElementById('loginView').hidden = true;

  // Navigation
  $('#backToWeddings').onclick = () => window.location.href = '/admin/';
  $('#signOut').hidden = false;
  $('#signOut').onclick = () => sb.auth.signOut().then(() => location.reload());
})();

function setupLoginForm() {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const btn = $('#loginBtn');
    const msg = $('#loginMsg');

    if (!email) return toast('Email is required', 'error');

    btn.disabled = true;
    btn.textContent = 'Sending…';
    msg.textContent = '';

    const { error } = await sb.auth.signInWithOtp({
      email: email,
      options: { shouldCreateUser: false }
    });

    btn.disabled = false;
    btn.textContent = 'Send me a login link';

    if (error) {
      msg.style.color = 'var(--danger)';
      msg.textContent = error.message;
    } else {
      msg.style.color = 'var(--accent)';
      msg.textContent = 'Check your email for the login link';
    }
  });
}

async function loadVenue(user) {
  USER = user;
  $('#whoami').textContent = `${user.email}`;

  // Get user's venue(s)
  const { data: memberships } = await sb.from('memberships')
    .select('venue_id').eq('user_id', user.id).single();

  if (!memberships || !memberships.venue_id) {
    document.getElementById('venueView').innerHTML = `
      <div class="panel">
        <h1>No venue access</h1>
        <p>Your account isn't linked to a venue.</p>
      </div>
    `;
    return;
  }

  const { data: venue } = await sb.from('venues')
    .select('*').eq('id', memberships.venue_id).single();

  if (!venue) return toast('Venue not found', 'error');

  VENUE = venue;
  fillVenueForm(venue);
  await loadMenus(venue.id);

  $('#venueTitle').textContent = venue.name;
  $('#venueSub').textContent = 'Manage your venue details and meal menus';

  // Wire up form
  $('#venueForm').addEventListener('submit', async e => {
    e.preventDefault();
    await saveVenue();
  });

  // Wire up menu buttons
  $('#addMenuBtn').onclick = () => {
    $('#addMenuPanel').hidden = false;
    $('#newMenuName').focus();
  };

  $('#cancelMenuForm').onclick = () => {
    $('#addMenuPanel').hidden = true;
    $('#addMenuForm').reset();
    document.querySelector('#addMenuPanel .panel__title').textContent = 'Create Menu';
    document.querySelector('#addMenuForm button[type="submit"]').textContent = 'Create';
    EDITING_MENU_ID = null;
  };

  $('#addMenuForm').addEventListener('submit', async e => {
    e.preventDefault();
    await createMenu();
  });
}

function fillVenueForm(venue) {
  $('#venueName').value = venue.name || '';
  $('#venueEmail').value = venue.contact_email || '';
  $('#venuePhone').value = venue.phone || '';
  $('#venueAddress').value = venue.address || '';
  $('#venueParking').value = venue.parking_info || '';
  $('#venueMaps').value = venue.location_maps_url || '';
}

async function saveVenue() {
  const btn = document.querySelector('#venueForm button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const patch = {
    name: $('#venueName').value.trim(),
    contact_email: $('#venueEmail').value.trim() || null,
    phone: $('#venuePhone').value.trim() || null,
    address: $('#venueAddress').value.trim() || null,
    parking_info: $('#venueParking').value.trim() || null,
    location_maps_url: $('#venueMaps').value.trim() || null
  };

  const { error } = await sb.from('venues').update(patch).eq('id', VENUE.id);

  btn.disabled = false;
  btn.textContent = 'Save Venue Details';

  if (error) {
    toast(error.message, 'error');
  } else {
    Object.assign(VENUE, patch);
    toast('Venue details saved', 'success');
  }
}

async function loadMenus(venueId) {
  const { data: menus } = await sb.from('venue_menus').select('*')
    .eq('venue_id', venueId).order('created_at');

  renderMenus(menus || []);
}

function renderMenus(menus) {
  const host = $('#menusList');
  host.innerHTML = '';

  if (!menus.length) {
    host.append(el('p', { class: 'empty', text: 'No menus created yet. Create one to offer couples different meal options.' }));
    return;
  }

  const rows = menus.map(m => el('tr', {},
    el('td', { text: m.name }),
    el('td', { class: 'muted', text: m.meal_options.join(', ') }),
    el('td', { class: 'muted', text: m.child_meal_options.length ? m.child_meal_options.join(', ') : '—' }),
    el('td', { style: 'display:flex;gap:0.5rem' },
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: 'Edit',
        onclick: () => editMenu(m)
      }),
      el('button', {
        class: 'btn btn--danger btn--sm', type: 'button', text: 'Delete',
        onclick: async () => {
          if (!confirm(`Delete the "${m.name}" menu?`)) return;
          const { error } = await sb.from('venue_menus').delete().eq('id', m.id);
          if (error) return toast(error.message, 'error');
          await loadMenus(VENUE.id);
          toast('Menu deleted', 'success');
        }
      }))));

  host.append(table(['Menu', 'Meal options', 'Children\'s options', ''], rows));
}

function table(headers, rows) {
  return el('div', { class: 'tbl-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, ...headers.map(h => el('th', { text: h })))),
      el('tbody', {}, ...rows)));
}

function editMenu(menu) {
  EDITING_MENU_ID = menu.id;
  $('#newMenuName').value = menu.name;
  $('#newMenuOptions').value = menu.meal_options.join('\n');
  $('#newMenuChildOptions').value = menu.child_meal_options.join('\n');
  document.querySelector('#addMenuPanel .panel__title').textContent = 'Edit menu';
  document.querySelector('#addMenuForm button[type="submit"]').textContent = 'Save changes';
  $('#addMenuPanel').hidden = false;
  $('#newMenuName').focus();
}

async function createMenu() {
  const name = $('#newMenuName').value?.trim() || '';
  const optionsText = $('#newMenuOptions').value?.trim() || '';
  const childOptionsText = $('#newMenuChildOptions').value?.trim() || '';

  const options = optionsText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const childOptions = childOptionsText.split('\n').map(s => s.trim()).filter(s => s.length > 0);

  if (!name) return toast('Menu label is required', 'error');
  if (!options.length) return toast('Add at least one meal option', 'error');

  const btn = document.querySelector('#addMenuForm button[type="submit"]');
  btn.disabled = true;
  const isEditing = EDITING_MENU_ID !== null;
  btn.textContent = isEditing ? 'Saving…' : 'Creating…';

  let result;
  if (isEditing) {
    result = await sb.from('venue_menus').update({
      name: name,
      meal_options: options,
      child_meal_options: childOptions
    }).eq('id', EDITING_MENU_ID);
  } else {
    result = await sb.from('venue_menus').insert({
      venue_id: VENUE.id,
      name: name,
      meal_options: options,
      child_meal_options: childOptions
    });
  }

  const { error } = result;
  btn.disabled = false;
  btn.textContent = isEditing ? 'Save changes' : 'Create';

  if (error) {
    toast(error.message, 'error');
  } else {
    $('#addMenuPanel').hidden = true;
    $('#addMenuForm').reset();
    document.querySelector('#addMenuPanel .panel__title').textContent = 'Create Menu';
    document.querySelector('#addMenuForm button[type="submit"]').textContent = 'Create';
    EDITING_MENU_ID = null;
    await loadMenus(VENUE.id);
    toast(isEditing ? 'Menu updated' : 'Menu created', 'success');
  }
}
