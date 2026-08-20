// ---------------------------------------------------------------------------
//  Guest photo upload — the page behind the QR code on the tables.
// ---------------------------------------------------------------------------
import { sb, cfg, resolveSlug, $, el, downscaleImage, randomName, toast } from './app.js?v=11';

const MAX_MB = cfg.MAX_UPLOAD_MB || 12;
let SLUG = '', WEDDING = null, QUEUE = [], KEY = '';

(async function boot() {
  SLUG = await resolveSlug();
  $('#maxMb').textContent = MAX_MB;
  $('#backLink').href = `/w/${SLUG}`;

  $('#keyForm').addEventListener('submit', e => {
    e.preventDefault();
    tryKey($('#keyInput').value.trim());
  });

  // The QR code carries ?k=…, so a guest scanning it never types anything.
  await tryKey(new URL(location.href).searchParams.get('k') || '', true);
})();

async function tryKey(key, silent = false) {
  const btn = $('#keyBtn');
  if (!silent) { btn.disabled = true; btn.textContent = 'Checking…'; }

  const { data, error } = await sb.rpc('upload_check', { p_slug: SLUG, p_key: key });

  if (!silent) { btn.disabled = false; btn.textContent = 'Continue'; }

  if (error || !data) {
    $('#title').textContent = 'Not found';
    $('#sub').textContent = 'We could not find this wedding.';
    return;
  }

  if (data.partner_a) {
    document.documentElement.dataset.theme = data.theme || 'ivory-sage';
    document.title = `Share your photos — ${data.partner_a} & ${data.partner_b}`;
    $('#title').textContent = `${data.partner_a} & ${data.partner_b}`;
  }

  if (data.ok) {
    KEY = data.key;
    WEDDING = { id: data.wedding_id, partner_a: data.partner_a, partner_b: data.partner_b };
    $('#eyebrow').textContent = 'Share the day';
    $('#sub').textContent =
      'Add the photographs you took — they go straight to the couple.';
    $('#keyForm').hidden = true;
    $('#form').hidden = false;
    wire();
    return;
  }

  $('#form').hidden = true;

  if (data.reason === 'not_found') {
    $('#title').textContent = 'Not found';
    $('#sub').textContent = 'We could not find this wedding.';
    return;
  }

  if (data.reason === 'demo') {
    $('#keyForm').hidden = true;
    $('#eyebrow').textContent = 'Example';
    $('#sub').textContent =
      'This is a demonstration site, so uploading is switched off here. On a real '
      + 'wedding, guests scan a QR code on their table and their photographs go '
      + 'straight to the couple — who choose which ones appear in the album.';
    return;
  }

  if (data.reason === 'closed') {
    $('#eyebrow').textContent = 'Closed';
    $('#sub').textContent = 'Photo sharing is not open for this wedding at the moment.';
    return;
  }

  // Wrong or missing key: ask for it rather than turning them away.
  $('#eyebrow').textContent = 'Share the day';
  $('#sub').textContent = 'Enter the photo code to add your pictures.';
  $('#keyForm').hidden = false;

  if (key) {
    $('#keyHint').textContent = 'That code was not recognised. Check the card on your table.';
    $('#keyHint').style.color = 'var(--accent)';
  }
  $('#keyInput').focus();
}

function wire() {
  const drop = $('#drop'), input = $('#files');

  drop.onclick = () => input.click();
  drop.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  };
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', e => add(e.dataTransfer.files));
  input.addEventListener('change', () => { add(input.files); input.value = ''; });

  $('#more').onclick = () => {
    QUEUE = []; $('#queue').innerHTML = '';
    $('#done').hidden = true; $('#form').hidden = false;
    $('#bar').hidden = true; $('#barFill').style.width = '0';
    refresh();
  };

  $('#form').addEventListener('submit', send);
}

function add(fileList) {
  for (const f of fileList) {
    if (!f.type.startsWith('image/')) { toast(`${f.name} isn’t an image.`, 'error'); continue; }
    if (f.size > MAX_MB * 1024 * 1024) { toast(`${f.name} is over ${MAX_MB}MB.`, 'error'); continue; }
    if (QUEUE.length >= 30) { toast('30 photos at a time, please.', 'error'); break; }

    const item = { file: f, state: 'ready', url: URL.createObjectURL(f) };
    QUEUE.push(item);

    $('#queue').append(el('li', { 'data-i': QUEUE.length - 1 },
      el('img', { src: item.url, alt: '' }),
      el('span', { class: 'queue__name', text: f.name }),
      el('span', { class: 'queue__state', text: `${(f.size / 1048576).toFixed(1)}MB` })
    ));
  }
  refresh();
}

function refresh() {
  const n = QUEUE.filter(q => q.state === 'ready').length;
  const btn = $('#send');
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? 'Send photographs'
    : `Send ${n} photograph${n === 1 ? '' : 's'}`;
}

function mark(i, text, cls) {
  const node = $(`#queue li[data-i="${i}"] .queue__state`);
  if (!node) return;
  node.textContent = text;
  node.className = `queue__state ${cls || ''}`;
}

async function send(e) {
  e.preventDefault();
  const pending = QUEUE.map((q, i) => ({ q, i })).filter(x => x.q.state === 'ready');
  if (!pending.length) return;

  const who = $('#who').value.trim();
  const caption = $('#caption').value.trim();
  const btn = $('#send');
  btn.disabled = true; btn.textContent = 'Sending…';
  $('#bar').hidden = false;

  let ok = 0;
  for (let n = 0; n < pending.length; n++) {
    const { q, i } = pending[n];
    mark(i, 'Sending…');
    try {
      const file = await downscaleImage(q.file);
      // The key is part of the path — the storage policy checks it there, so a
      // forged upload straight to storage is rejected too.
      const path = `guest/${WEDDING.id}/${KEY}/${randomName('jpg')}`;

      const { error: upErr } = await sb.storage.from('wedding-photos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { error: rpcErr } = await sb.rpc('guest_photo_submit', {
        p_slug: SLUG, p_path: path, p_name: who, p_caption: caption
      });
      if (rpcErr) throw rpcErr;

      q.state = 'done';
      mark(i, 'Sent', 'is-done');
      ok++;
    } catch (err) {
      q.state = 'error';
      mark(i, 'Failed', 'is-error');
      console.error(err);
    }
    $('#barFill').style.width = `${Math.round(((n + 1) / pending.length) * 100)}%`;
  }

  btn.disabled = false;
  refresh();

  if (ok) {
    $('#form').hidden = true;
    $('#done').hidden = false;
    $('#doneBody').textContent =
      `${ok} photograph${ok === 1 ? '' : 's'} sent to ${WEDDING.partner_a} and `
      + `${WEDDING.partner_b}. They’ll appear in the album once approved.`;
  } else {
    toast('Nothing could be sent. Check your signal and try again.', 'error');
  }
}
