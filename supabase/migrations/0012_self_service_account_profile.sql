-- Self-service account and linked household profile updates.
-- Run after 0011_payment_qr_settings.sql.

create or replace function public.resolve_login_email(target_identifier text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select account.email
  from public.user_profiles profile
  join auth.users account on account.id = profile.user_id
  where lower(profile.username) = lower(trim(target_identifier))
  limit 1;
$$;

revoke execute on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.update_my_account_profile(
  target_username text,
  target_full_name text,
  target_phone text default '',
  target_bank_account text default '',
  target_bank_name text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_username text := trim(target_username);
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if normalized_username !~ '^[a-zA-Z0-9._-]{3,32}$' then
    raise exception 'Invalid username';
  end if;
  if char_length(trim(target_full_name)) not between 1 and 120 then
    raise exception 'Invalid full name';
  end if;

  update public.user_profiles set
    username = normalized_username,
    updated_at = now()
  where user_id = current_user_id;

  if not found then
    insert into public.user_profiles (user_id, username)
    values (current_user_id, normalized_username);
  end if;

  update public.household_members set
    full_name = trim(target_full_name),
    phone = nullif(trim(target_phone), ''),
    bank_account = nullif(trim(target_bank_account), ''),
    bank_name = nullif(trim(target_bank_name), ''),
    updated_at = now()
  where auth_user_id = current_user_id and is_active;

  if not found then raise exception 'Linked household member required'; end if;
end;
$$;

revoke execute on function public.update_my_account_profile(text, text, text, text, text) from public, anon;
grant execute on function public.update_my_account_profile(text, text, text, text, text) to authenticated;
