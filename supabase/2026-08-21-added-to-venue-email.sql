-- Email for someone given venue access who already had an account.
--
-- send_welcome_email tells the reader their password is "the password you just
-- created", which is true after the invite flow and false here — this route
-- exists precisely because they already had one. Sending it unchanged points
-- people at a setup step that never happened, so this is a sibling rather than
-- an edit to the shared function.

create or replace function public.send_added_to_venue_email(
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
      'subject', 'You now have access to ' || p_venue_name,
      'html', '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2b2f29;max-width:34rem">'
           || '<p>You''ve been given access to manage <strong>' || p_venue_name || '</strong> on Join Us For.</p>'
           || '<p>You already have an account, so there is nothing to set up. '
           || 'Sign in with your usual email and password:</p>'
           || '<p><strong>Email:</strong> ' || p_email || '</p>'
           || '<p><a href="https://joinusfor.co.uk/admin/venue-settings.html" style="color:#63755a;font-weight:bold">Log in to manage your venue</a></p>'
           || '<p style="font-size:14px">Forgotten your password? '
           || '<a href="https://joinusfor.co.uk/admin/reset-password.html" style="color:#63755a">Set a new one</a>.</p>'
           || '<p>If you have any questions, reply to this email.</p>'
           || '<p>Best wishes,<br>Join Us For</p>'
           || '<p style="font-size:13px;color:#666c62">hello@joinusfor.co.uk</p></div>'
    )::text
  ));

  return v_result;
end $$;

revoke all on function public.send_added_to_venue_email(text, text) from public;
grant execute on function public.send_added_to_venue_email(text, text) to authenticated;
