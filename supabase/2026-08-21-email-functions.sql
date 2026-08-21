-- Transactional email, via Resend.
--
-- These two were written straight into the SQL editor and existed only in the
-- database until now: a rebuild from this repo produced a system that silently
-- could not send anything. Captured verbatim from pg_get_functiondef.
--
-- The API key lives in public.settings under 'resend_api_key'. Every function
-- here is security definer so it can read that row while the table itself
-- stays unreadable to clients — see 2026-08-21-settings-lockdown.sql.

create extension if not exists http;

create or replace function public.send_invite_email(
  p_email text, p_venue_name text, p_invite_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_resend_key text;
  v_result jsonb;
  v_invite_url text;
begin
  select value into v_resend_key from public.settings where key = 'resend_api_key';

  if v_resend_key is null then
    return jsonb_build_object('error', 'Resend API key not configured');
  end if;

  v_invite_url := 'https://joinusfor.co.uk/admin/owner/invite.html?token=' || p_invite_token;

  select content::jsonb into v_result from http((
    'POST',
    'https://api.resend.com/emails',
    array[http_header('Authorization', 'Bearer ' || v_resend_key),
          http_header('Content-Type', 'application/json')],
    'application/json',
    jsonb_build_object(
      'from', 'hello@joinusfor.co.uk',
      'to', p_email,
      'subject', 'Set up your ' || p_venue_name || ' admin account',
      'html', '<p>You''ve been invited to manage ' || p_venue_name || ' on Join Us For.</p><p><a href="' || v_invite_url || '">Set up your account</a></p><p>This link expires in 3 days.</p>'
    )::text
  ));

  return v_result;
end $$;

-- Sent after someone completes the invite and chooses a password. For an
-- account that already existed, send_added_to_venue_email is the right one —
-- this wording assumes a password was just created.
create or replace function public.send_welcome_email(
  p_email text, p_venue_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_resend_key text;
  v_result jsonb;
begin
  select value into v_resend_key from public.settings where key = 'resend_api_key';

  if v_resend_key is null then
    return jsonb_build_object('error', 'Resend API key not configured');
  end if;

  select content::jsonb into v_result from http((
    'POST',
    'https://api.resend.com/emails',
    array[http_header('Authorization', 'Bearer ' || v_resend_key),
          http_header('Content-Type', 'application/json')],
    'application/json',
    jsonb_build_object(
      'from', 'hello@joinusfor.co.uk',
      'to', p_email,
      'subject', 'Welcome to ' || p_venue_name || ' — Your login details',
      'html', '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2b2f29;max-width:34rem"><p>Welcome to Join Us For!</p><p>Your account for <strong>' || p_venue_name || '</strong> is now set up and ready to use.</p><p><strong>Login details:</strong><br>Email: ' || p_email || '<br>Password: The password you just created</p><p><a href="https://joinusfor.co.uk/admin/venue-settings.html" style="color:#63755a;font-weight:bold">Log in to manage your venue</a></p><p>If you have any questions, reply to this email.</p><p>Best wishes,<br>Join Us For</p><p style="font-size:13px;color:#666c62">hello@joinusfor.co.uk</p></div>'
    )::text
  ));

  return v_result;
end $$;
