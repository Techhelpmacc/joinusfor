// ---------------------------------------------------------------------------
//  Shared plumbing: Supabase client, tenant resolution, small DOM helpers.
//  No build step — this is a native ES module loaded straight from the CDN.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CFG = window.WEDDING_HUB || {};

export const cfg = CFG;
export const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/**
 * Work out which wedding this page is for, in order of specificity:
 *   1. ?w=slug                     — preview / local development
 *   2. /w/slug  or  /u/slug        — path routing on the shared domain
 *   3. custom domain               — johnandamyswedding.com  (DB lookup)
 *   4. first hostname label        — johnandamy.venue.co.uk  (wildcard DNS)
 *   5. DEFAULT_SLUG from config.js
 */
export async function resolveSlug() {
  const url = new URL(location.href);

  const q = url.searchParams.get('w');
  if (q) return q.toLowerCase();

  const seg = url.pathname.split('/').filter(Boolean);
  if ((seg[0] === 'w' || seg[0] === 'u') && seg[1]) return seg[1].toLowerCase();

  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const isLocal = host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host);

  if (!isLocal) {
    // A couple's own domain resolves through the database.
    const { data } = await sb.rpc('resolve_host', { p_host: host });
    if (data) return data;

    // Otherwise treat a three-label host as venue wildcard: <slug>.venue.co.uk
    const labels = host.split('.');
    if (labels.length >= 3) return labels[0];
  }

  return (CFG.DEFAULT_SLUG || '').toLowerCase();
}

/**
 * Send a sign-in link to somebody else. Uses a throwaway client with no session
 * storage, so the person doing the inviting stays signed in as themselves.
 * shouldCreateUser makes this work for people who have no account yet.
 */
export async function sendInviteEmail(email, redirectTo) {
  const throwaway = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return throwaway.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo }
  });
}

export function publicPhotoUrl(path) {
  return sb.storage.from('wedding-photos').getPublicUrl(path).data.publicUrl;
}

// --------------------------------------------------------------- helpers ---

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/** Build an element. Text is set via textContent, so it is never parsed as HTML. */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

export function formatDate(iso, style = 'long') {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (style === 'short') return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return `${days[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

export function toast(msg, kind = 'info') {
  let host = $('.wh-toasts');
  if (!host) { host = el('div', { class: 'wh-toasts' }); document.body.append(host); }
  const t = el('div', { class: `wh-toast wh-toast--${kind}`, role: 'status', text: msg });
  host.append(t);
  setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, 4200);
}

/** Shrink a photo in the browser before upload — keeps storage costs sane. */
export async function downscaleImage(file, maxEdge = 2200, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3_000_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(bmp.width  * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();

    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;                       // any failure: upload the original
  }
}

export function randomName(ext = 'jpg') {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
}
