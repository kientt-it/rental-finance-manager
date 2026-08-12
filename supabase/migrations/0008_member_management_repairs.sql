-- Repair member listing and allow admins to attach an existing account.
-- Run after 0007_username_and_google_auth.sql.

-- Every organization owner must also have an administrator membership.
insert into public.members (organization_id, user_id, role)
select organization.id, organization.owner_user_id, 'admin'::public.member_role
from public.organizations organization
on conflict (organization_id, user_id) do update
set role = 'admin'::public.member_role;

create or replace function public.get_manageable_members()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  phone text,
  bank_account text,
  bank_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with target_organization as (
    select member.organization_id
    from public.members member
    where member.user_id = auth.uid()
      and member.role::text = 'admin'
    order by member.created_at
    limit 1
  )
  select
    member.user_id,
    coalesce(nullif(member.full_name, ''), profile.username, 'Thành viên')::text,
    coalesce(profile.contact_email, '')::text,
    member.role::text,
    coalesce(member.phone, '')::text,
    coalesce(member.bank_account, '')::text,
    coalesce(member.bank_name, '')::text
  from target_organization target
  join public.members member on member.organization_id = target.organization_id
  left join public.user_profiles profile on profile.user_id = member.user_id
  order by case when member.user_id = auth.uid() then 0 else 1 end, 2;
$$;

create or replace function public.add_organization_member_by_login(
  target_identifier text,
  target_full_name text,
  target_role text default 'member'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  target_user_id uuid;
  normalized_identifier text := lower(trim(target_identifier));
begin
  select member.organization_id into target_organization_id
  from public.members member
  where member.user_id = auth.uid() and member.role::text = 'admin'
  order by member.created_at
  limit 1;

  if target_organization_id is null then
    raise exception 'Administrator permission required';
  end if;
  if target_role not in ('admin', 'member') then
    raise exception 'Invalid role';
  end if;

  select profile.user_id into target_user_id
  from public.user_profiles profile
  where lower(profile.username) = normalized_identifier
     or lower(coalesce(profile.contact_email, '')) = normalized_identifier
  order by case when lower(profile.username) = normalized_identifier then 0 else 1 end
  limit 1;

  if target_user_id is null then
    select account.id into target_user_id
    from auth.users account
    where lower(coalesce(account.email, '')) = normalized_identifier
    limit 1;
  end if;

  if target_user_id is null then
    raise exception 'Account not found. The member must register before being added.';
  end if;

  delete from public.removed_organization_users removed
  where removed.organization_id = target_organization_id
    and removed.user_id = target_user_id;

  insert into public.members (organization_id, user_id, role, full_name)
  values (target_organization_id, target_user_id, target_role::public.member_role, nullif(trim(target_full_name), ''))
  on conflict (organization_id, user_id) do update
  set role = excluded.role,
      full_name = coalesce(excluded.full_name, public.members.full_name);

  return target_user_id;
end;
$$;

revoke execute on function public.get_manageable_members() from public, anon;
revoke execute on function public.add_organization_member_by_login(text, text, text) from public, anon;
grant execute on function public.get_manageable_members() to authenticated;
grant execute on function public.add_organization_member_by_login(text, text, text) to authenticated;
