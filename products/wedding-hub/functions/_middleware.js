// ---------------------------------------------------------------------------
//  Host-aware routing.
//
//  Every domain attached to this project serves the same files, so without
//  this the root of a couple's own domain (johnandamyswedding.com) shows the
//  sales page — i.e. their guests land on a pitch aimed at wedding venues.
//
//  On any host that is not ours, "/" serves the wedding site instead. The
//  address bar is untouched: this is a rewrite, not a redirect, so the couple
//  keeps the clean domain they paid for.
// ---------------------------------------------------------------------------

const PLATFORM_HOSTS = ['joinusfor.co.uk'];

function isPlatformHost(host) {
  return PLATFORM_HOSTS.includes(host)
      || host.endsWith('.pages.dev')      // Cloudflare preview builds
      || host === 'localhost'
      || host.startsWith('127.')
      || host.endsWith('.local');
}

export async function onRequest(context) {
  const { request, next } = context;

  try {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    if (!isPlatformHost(host) && (url.pathname === '/' || url.pathname === '')) {
      const target = new URL(url);
      target.pathname = '/wedding/';
      return next(new Request(target.toString(), request));
    }
  } catch {
    // Routing must never be the reason a wedding site is down.
  }

  return next();
}
