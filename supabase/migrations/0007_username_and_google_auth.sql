-- Username/password accounts, Google profiles, and automatic organization membership.
-- Run after 0006_roles_and_full_crud.sql.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(username) between 3 and 64)
);

create unique index if not exists user_profiles_username_lower_idx
  on public.user_profiles (lower(username));

alter table public.user_profiles enable row level security;

create table if not exists public.removed_organization_users (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  removed_by uuid not null references auth.users(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.removed_organization_users enable row level security;

drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile" on public.user_profiles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users update own profile" on public.user_profiles;
create policy "Users update own profile" on public.user_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Admins manage removed users" on public.removed_organization_users;
create policy "Admins manage removed users" on public.removed_organization_users for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create or replace function public.create_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  resolved_username text;
  suffix integer := 0;
  resolved_contact_email text;
begin
  base_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );
  base_username := left(base_username, 52);
  resolved_username := base_username;

  while exists (select 1 from public.user_profiles where lower(username) = lower(resolved_username)) loop
    suffix := suffix + 1;
    resolved_username := left(base_username, 52) || '-' || suffix::text;
  end loop;

  resolved_contact_email := nullif(trim(new.raw_user_meta_data ->> 'contact_email'), '');
  if resolved_contact_email is null and coalesce(new.email, '') not like '%@users.708.local' then
    resolved_contact_email := new.email;
  end if;

  insert into public.user_profiles (user_id, username, contact_email)
  values (new.id, resolved_username, resolved_contact_email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_auth_user_profile_trigger on auth.users;
create trigger create_auth_user_profile_trigger
  after insert on auth.users
  for each row execute function public.create_auth_user_profile();

-- Backfill accounts created before this migration; only duplicate names get a suffix.
with profile_candidates as (
  select
    account.id,
    left(coalesce(
      nullif(trim(account.raw_user_meta_data ->> 'username'), ''),
      nullif(trim(account.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
      'user'
    ), 52) as base_username,
    case
      when nullif(trim(account.raw_user_meta_data ->> 'contact_email'), '') is not null
        then trim(account.raw_user_meta_data ->> 'contact_email')
      when coalesce(account.email, '') not like '%@users.708.local' then account.email
      else null
    end as contact_email
  from auth.users account
), ranked_profiles as (
  select *, count(*) over (partition by lower(base_username)) as duplicate_count
  from profile_candidates
)
insert into public.user_profiles (user_id, username, contact_email)
select
  id,
  case when duplicate_count = 1 then base_username else left(base_username, 52) || '-' || left(id::text, 6) end,
  contact_email
from ranked_profiles
on conflict (user_id) do nothing;

-- Single-property application: the first account is admin; later registrations
-- automatically join the existing organization as members.
create or replace function public.bootstrap_current_user()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_organization_id uuid;
  target_property_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select organization_id into target_organization_id
  from public.members
  where user_id = current_user_id
  order by created_at
  limit 1;

  if target_organization_id is null then
    select id into target_organization_id
    from public.organizations
    order by created_at
    limit 1;

    if target_organization_id is null then
      insert into public.organizations (name, owner_user_id)
      values ('Nhà trọ của tôi', current_user_id)
      returning id into target_organization_id;

      insert into public.members (organization_id, user_id, role)
      values (target_organization_id, current_user_id, 'admin');
    else
      if exists (
        select 1 from public.removed_organization_users
        where organization_id = target_organization_id and user_id = current_user_id
      ) then
        raise exception 'Your access was removed by an administrator';
      end if;

      insert into public.members (organization_id, user_id, role)
      values (target_organization_id, current_user_id, 'member')
      on conflict (organization_id, user_id) do nothing;
    end if;
  end if;

  select id into target_property_id
  from public.properties
  where organization_id = target_organization_id
  order by created_at
  limit 1;

  if target_property_id is null then
    insert into public.properties (organization_id, name)
    values (target_organization_id, 'Nhà trọ của tôi');
  end if;

  return target_organization_id;
end;
$$;

create or replace function public.delete_organization_member(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.members where user_id = auth.uid() order by created_at limit 1;
  if target_organization_id is null or not public.is_organization_admin(target_organization_id) then
    raise exception 'Administrator permission required';
  end if;
  if target_user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;

  insert into public.removed_organization_users (organization_id, user_id, removed_by)
  values (target_organization_id, target_user_id, auth.uid())
  on conflict (organization_id, user_id) do update
    set removed_by = excluded.removed_by, removed_at = now();

  delete from public.members
  where organization_id = target_organization_id and user_id = target_user_id;
  if not found then raise exception 'Member not found'; end if;
end;
$$;

drop function if exists public.get_organization_users();
create function public.get_organization_users()
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  with target_organization as (
    select organization_id from public.members
    where user_id = auth.uid() order by created_at limit 1
  )
  select
    member.user_id,
    coalesce(nullif(member.full_name, ''), profile.username, 'Thành viên'),
    coalesce(profile.contact_email, '')
  from target_organization target
  join public.members member on member.organization_id = target.organization_id
  left join public.user_profiles profile on profile.user_id = member.user_id
  order by case when member.user_id = auth.uid() then 0 else 1 end, 2;
$$;

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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.members where user_id = auth.uid() order by created_at limit 1;
  if target_organization_id is null or not public.is_organization_admin(target_organization_id) then
    raise exception 'Administrator permission required';
  end if;

  return query
  select
    member.user_id,
    coalesce(nullif(member.full_name, ''), profile.username, 'Thành viên'),
    coalesce(profile.contact_email, ''),
    member.role::text,
    coalesce(member.phone, ''),
    coalesce(member.bank_account, ''),
    coalesce(member.bank_name, '')
  from public.members member
  left join public.user_profiles profile on profile.user_id = member.user_id
  where member.organization_id = target_organization_id
  order by case when member.user_id = auth.uid() then 0 else 1 end, 2;
end;
$$;

revoke execute on function public.bootstrap_current_user() from public, anon;
revoke execute on function public.get_organization_users() from public, anon;
revoke execute on function public.get_manageable_members() from public, anon;
revoke execute on function public.delete_organization_member(uuid) from public, anon;
grant execute on function public.bootstrap_current_user() to authenticated;
grant execute on function public.get_organization_users() to authenticated;
grant execute on function public.get_manageable_members() to authenticated;
grant execute on function public.delete_organization_member(uuid) to authenticated;
