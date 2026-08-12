-- Role-based member management and real CRUD data for the management screens.
-- Run after 0005_current_organization_users.sql.

-- Keep existing memberships while simplifying roles to admin/member.
do $$
begin
  if exists (select 1 from pg_enum where enumtypid = 'public.member_role'::regtype and enumlabel = 'owner')
     and not exists (select 1 from pg_enum where enumtypid = 'public.member_role'::regtype and enumlabel = 'admin') then
    alter type public.member_role rename value 'owner' to 'admin';
  end if;
  if exists (select 1 from pg_enum where enumtypid = 'public.member_role'::regtype and enumlabel = 'viewer')
     and not exists (select 1 from pg_enum where enumtypid = 'public.member_role'::regtype and enumlabel = 'member') then
    alter type public.member_role rename value 'viewer' to 'member';
  end if;
end $$;

update public.members set role = 'admin' where role::text in ('owner', 'manager');
update public.members set role = 'member' where role::text = 'viewer';
alter table public.members alter column role set default 'member';
alter table public.members add column if not exists full_name text;
alter table public.members add column if not exists phone text;
alter table public.members add column if not exists bank_account text;
alter table public.members add column if not exists bank_name text;

alter table public.rooms add column if not exists floor integer not null default 1 check (floor > 0);
alter table public.rooms add column if not exists room_type text not null default 'Phòng tiêu chuẩn';
alter table public.rooms add column if not exists coefficient numeric(8, 3) not null default 1 check (coefficient > 0);
alter table public.rooms add column if not exists residents text[] not null default '{}';

alter table public.expenses add column if not exists payer_user_id uuid references auth.users(id) on delete set null;
alter table public.expenses add column if not exists status text not null default 'completed'
  check (status in ('pending', 'completed'));
alter table public.expenses add column if not exists reference_code text;

create table if not exists public.expense_participants (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  allocated_amount numeric(14, 2) not null default 0 check (allocated_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (expense_id, user_id)
);

create table if not exists public.member_settlements (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period date not null check (date_trunc('month', period)::date = period),
  is_settled boolean not null default false,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (property_id, user_id, period)
);

alter table public.expense_participants enable row level security;
alter table public.member_settlements enable row level security;

drop policy if exists "Member access" on public.expense_participants;
create policy "Member access" on public.expense_participants for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

drop policy if exists "Member access" on public.member_settlements;
create policy "Member access" on public.member_settlements for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

create index if not exists expense_participants_organization_idx
  on public.expense_participants (organization_id, user_id);
create index if not exists member_settlements_period_idx
  on public.member_settlements (property_id, period desc);

create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role::text = 'admin'
  );
$$;

-- Preserve compatibility with policies/functions created by older migrations.
create or replace function public.is_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_organization_admin(target_organization_id); $$;

grant execute on function public.is_organization_admin(uuid) to authenticated;

drop policy if exists "Members can read organization memberships" on public.members;
create policy "Members read self and admins read organization" on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_organization_admin(organization_id));

create or replace function public.get_current_membership()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'organization_id', m.organization_id,
    'role', m.role::text
  )
  from public.members m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

drop function if exists public.get_organization_users();
create function public.get_organization_users()
returns table (
  user_id uuid,
  full_name text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  with target_organization as (
    select organization_id
    from public.members
    where user_id = auth.uid()
    order by created_at
    limit 1
  )
  select
    account.id,
    coalesce(nullif(member.full_name, ''), nullif(account.raw_user_meta_data ->> 'full_name', ''), split_part(account.email, '@', 1)),
    coalesce(account.email, '')
  from target_organization target
  join public.members member on member.organization_id = target.organization_id
  join auth.users account on account.id = member.user_id
  order by case when account.id = auth.uid() then 0 else 1 end, 2;
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
    account.id,
    coalesce(nullif(member.full_name, ''), nullif(account.raw_user_meta_data ->> 'full_name', ''), split_part(account.email, '@', 1)),
    coalesce(account.email, ''),
    member.role::text,
    coalesce(member.phone, ''),
    coalesce(member.bank_account, ''),
    coalesce(member.bank_name, '')
  from public.members member
  join auth.users account on account.id = member.user_id
  where member.organization_id = target_organization_id
  order by case when account.id = auth.uid() then 0 else 1 end, 2;
end;
$$;

create or replace function public.add_organization_member(
  target_email text,
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
begin
  select organization_id into target_organization_id
  from public.members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if target_organization_id is null or not public.is_organization_admin(target_organization_id) then
    raise exception 'Administrator permission required';
  end if;
  if target_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;

  select id into target_user_id from auth.users where lower(email) = lower(trim(target_email));
  if target_user_id is null then
    raise exception 'Account not found. The member must register before being added.';
  end if;

  insert into public.members (organization_id, user_id, role, full_name)
  values (target_organization_id, target_user_id, target_role::public.member_role, nullif(trim(target_full_name), ''))
  on conflict (organization_id, user_id) do update
    set role = excluded.role, full_name = coalesce(excluded.full_name, public.members.full_name);
  return target_user_id;
end;
$$;

create or replace function public.update_organization_member(
  target_user_id uuid,
  target_full_name text,
  target_phone text,
  target_bank_account text,
  target_bank_name text,
  target_role text
)
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
  if target_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;
  if target_user_id = auth.uid() and target_role <> 'admin' then
    raise exception 'You cannot remove your own administrator role';
  end if;

  update public.members
  set full_name = nullif(trim(target_full_name), ''),
      phone = nullif(trim(target_phone), ''),
      bank_account = nullif(trim(target_bank_account), ''),
      bank_name = nullif(trim(target_bank_name), ''),
      role = target_role::public.member_role
  where organization_id = target_organization_id and user_id = target_user_id;
  if not found then raise exception 'Member not found'; end if;
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

  delete from public.members
  where organization_id = target_organization_id and user_id = target_user_id;
  if not found then raise exception 'Member not found'; end if;
end;
$$;

create or replace function public.save_expense(
  target_expense_id uuid,
  target_property_id uuid,
  target_category text,
  target_amount numeric,
  target_expense_date date,
  target_payer_user_id uuid,
  target_participant_ids uuid[],
  target_status text default 'completed',
  target_reference_code text default null,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  saved_expense_id uuid;
  participant_id uuid;
  participant_count integer;
begin
  select organization_id into target_organization_id
  from public.members where user_id = auth.uid() order by created_at limit 1;
  if target_organization_id is null then raise exception 'Membership required'; end if;
  if target_amount <= 0 or char_length(trim(target_category)) < 2 then raise exception 'Invalid expense'; end if;
  if target_status not in ('pending', 'completed') then raise exception 'Invalid status'; end if;
  participant_count := coalesce(array_length(target_participant_ids, 1), 0);
  if participant_count = 0 then raise exception 'At least one participant is required'; end if;
  if not exists (select 1 from public.properties where id = target_property_id and organization_id = target_organization_id) then
    raise exception 'Property not found';
  end if;
  if not exists (select 1 from public.members where organization_id = target_organization_id and user_id = target_payer_user_id) then
    raise exception 'Payer is not a member';
  end if;

  if target_expense_id is null then
    insert into public.expenses (organization_id, property_id, category, amount, expense_date, note, payer_user_id, status, reference_code)
    values (target_organization_id, target_property_id, trim(target_category), target_amount, target_expense_date,
      nullif(trim(target_note), ''), target_payer_user_id, target_status, nullif(trim(target_reference_code), ''))
    returning id into saved_expense_id;
  else
    update public.expenses
    set category = trim(target_category), amount = target_amount, expense_date = target_expense_date,
        note = nullif(trim(target_note), ''), payer_user_id = target_payer_user_id,
        status = target_status, reference_code = nullif(trim(target_reference_code), '')
    where id = target_expense_id and organization_id = target_organization_id
    returning id into saved_expense_id;
    if saved_expense_id is null then raise exception 'Expense not found'; end if;
    delete from public.expense_participants where expense_id = saved_expense_id;
  end if;

  foreach participant_id in array target_participant_ids loop
    if not exists (select 1 from public.members where organization_id = target_organization_id and user_id = participant_id) then
      raise exception 'Participant is not a member';
    end if;
    insert into public.expense_participants (expense_id, organization_id, user_id, allocated_amount)
    values (saved_expense_id, target_organization_id, participant_id, target_amount / participant_count);
  end loop;
  return saved_expense_id;
end;
$$;

revoke execute on function public.get_current_membership() from public, anon;
revoke execute on function public.get_organization_users() from public, anon;
revoke execute on function public.get_manageable_members() from public, anon;
revoke execute on function public.add_organization_member(text, text, text) from public, anon;
revoke execute on function public.update_organization_member(uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.delete_organization_member(uuid) from public, anon;
revoke execute on function public.save_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) from public, anon;

grant execute on function public.get_current_membership() to authenticated;
grant execute on function public.get_organization_users() to authenticated;
grant execute on function public.get_manageable_members() to authenticated;
grant execute on function public.add_organization_member(text, text, text) to authenticated;
grant execute on function public.update_organization_member(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.delete_organization_member(uuid) to authenticated;
grant execute on function public.save_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) to authenticated;
