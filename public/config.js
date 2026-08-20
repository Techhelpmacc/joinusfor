// ---------------------------------------------------------------------------
//  The only file you edit to point the app at your Supabase project.
//  Both values are safe to publish — the anon key is protected by the
//  row-level security policies in supabase/install.sql.
// ---------------------------------------------------------------------------
window.WEDDING_HUB = {
  SUPABASE_URL: 'https://bdhwlcuprccbcasghyie.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_N2TYTEB9Zgu2uAquUE-uIg_A0E-uqnh',

  // Fallback wedding when the URL carries no slug (handy while developing).
  DEFAULT_SLUG: '',

  // Shown in the footer of every guest site.
  PLATFORM_NAME: 'Join Us For',
  PLATFORM_URL: 'https://joinusfor.co.uk',

  // Max upload size accepted from guests, in megabytes.
  MAX_UPLOAD_MB: 12
};
