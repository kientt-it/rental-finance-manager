-- Household member profiles can exist before a person creates an auth account.
-- public.members remains the access-control table; household_members is the
-- business identity used by rooms, expenses, and settlements.

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 1 and 120),
  phone text,
  bank_account text,
  bank_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, auth_user_id)
);

create table if not exists public.room_member_assignments (
  room_id uuid not null references public.rooms(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, member_id),
  unique (member_id)
);

alter table public.expenses
  add column if not exists payer_member_id uuid references public.household_members(id) on delete set null;

create table if not exists public.expense_member_participants (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete restrict,
  allocated_amount numeric(14, 2) not null default 0 check (allocated_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (expense_id, member_id)
);

create table if not exists public.household_member_settlements (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  period date not null check (date_trunc('month', period)::date = period),
  is_settled boolean not null default false,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (property_id, member_id, period)
);

-- Backfill one business profile for every existing account membership.
insert into public.household_members (
  organization_id, auth_user_id, full_name, phone, bank_account, bank_name
)
select
  membership.organization_id,
  membership.user_id,
  coalesce(nullif(membership.full_name, ''), profile.username, 'Thành viên'),
  membership.phone,
  membership.bank_account,
  membership.bank_name
from public.members membership
left join public.user_profiles profile on profile.user_id = membership.user_id
on conflict (organization_id, auth_user_id) do update set
  full_name = coalesce(nullif(public.household_members.full_name, ''), excluded.full_name),
  phone = coalesce(public.household_members.phone, excluded.phone),
  bank_account = coalesce(public.household_members.bank_account, excluded.bank_account),
  bank_name = coalesce(public.household_members.bank_name, excluded.bank_name);

update public.expenses expense
set payer_member_id = profile.id
from public.household_members profile
where expense.payer_member_id is null
  and expense.payer_user_id = profile.auth_user_id
  and expense.organization_id = profile.organization_id;

insert into public.expense_member_participants (expense_id, organization_id, member_id, allocated_amount)
select participant.expense_id, participant.organization_id, profile.id, participant.allocated_amount
from public.expense_participants participant
join public.household_members profile
  on profile.organization_id = participant.organization_id
 and profile.auth_user_id = participant.user_id
on conflict (expense_id, member_id) do update
set allocated_amount = excluded.allocated_amount;

insert into public.household_member_settlements (
  organization_id, property_id, member_id, period, is_settled, settled_at, updated_at
)
select settlement.organization_id, settlement.property_id, profile.id, settlement.period,
       settlement.is_settled, settlement.settled_at, settlement.updated_at
from public.member_settlements settlement
join public.household_members profile
  on profile.organization_id = settlement.organization_id
 and profile.auth_user_id = settlement.user_id
on conflict (property_id, member_id, period) do update set
  is_settled = excluded.is_settled,
  settled_at = excluded.settled_at,
  updated_at = excluded.updated_at;

alter table public.household_members enable row level security;
alter table public.room_member_assignments enable row level security;
alter table public.expense_member_participants enable row level security;
alter table public.household_member_settlements enable row level security;

create policy "Organization access" on public.household_members for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_admin(organization_id));
create policy "Organization access" on public.room_member_assignments for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
create policy "Organization access" on public.expense_member_participants for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
create policy "Organization access" on public.household_member_settlements for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

create index if not exists household_members_organization_idx on public.household_members (organization_id, is_active);
create index if not exists room_member_assignments_member_idx on public.room_member_assignments (member_id);
create index if not exists expense_member_participants_member_idx on public.expense_member_participants (member_id);
create index if not exists household_member_settlements_period_idx on public.household_member_settlements (property_id, period desc);

create or replace function public.get_household_members()
returns table (
  user_id uuid,
  auth_user_id uuid,
  full_name text,
  email text,
  role text,
  phone text,
  bank_account text,
  bank_name text,
  is_linked boolean
)
language sql stable security definer set search_path = public
as $$
  with target as (
    select membership.organization_id
    from public.members membership
    where membership.user_id = auth.uid()
    order by membership.created_at limit 1
  )
  select
    profile.id,
    profile.auth_user_id,
    profile.full_name,
    coalesce(user_profile.contact_email, account.email, '')::text,
    coalesce(access.role::text, 'member')::text,
    coalesce(profile.phone, '')::text,
    coalesce(profile.bank_account, '')::text,
    coalesce(profile.bank_name, '')::text,
    profile.auth_user_id is not null
  from target
  join public.household_members profile on profile.organization_id = target.organization_id
  left join public.members access
    on access.organization_id = profile.organization_id and access.user_id = profile.auth_user_id
  left join public.user_profiles user_profile on user_profile.user_id = profile.auth_user_id
  left join auth.users account on account.id = profile.auth_user_id
  where profile.is_active
  order by case when profile.auth_user_id = auth.uid() then 0 else 1 end, profile.full_name;
$$;

create or replace function public.create_household_member(
  target_full_name text,
  target_phone text default null,
  target_bank_account text default null,
  target_bank_name text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid; saved_id uuid;
begin
  select organization_id into target_organization_id from public.members
  where user_id = auth.uid() and role::text = 'admin' order by created_at limit 1;
  if target_organization_id is null then raise exception 'Administrator permission required'; end if;
  if char_length(trim(target_full_name)) < 1 then raise exception 'Full name required'; end if;
  insert into public.household_members (organization_id, full_name, phone, bank_account, bank_name)
  values (target_organization_id, trim(target_full_name), nullif(trim(target_phone), ''),
          nullif(trim(target_bank_account), ''), nullif(trim(target_bank_name), ''))
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.update_household_member(
  target_member_id uuid,
  target_full_name text,
  target_phone text,
  target_bank_account text,
  target_bank_name text
)
returns void language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id from public.members
  where user_id = auth.uid() and role::text = 'admin' order by created_at limit 1;
  if target_organization_id is null then raise exception 'Administrator permission required'; end if;
  update public.household_members set
    full_name = trim(target_full_name), phone = nullif(trim(target_phone), ''),
    bank_account = nullif(trim(target_bank_account), ''), bank_name = nullif(trim(target_bank_name), ''),
    updated_at = now()
  where id = target_member_id and organization_id = target_organization_id;
  if not found then raise exception 'Member not found'; end if;
end;
$$;

create or replace function public.link_household_member_account(
  target_member_id uuid,
  target_identifier text,
  target_role text default 'member'
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid; matched_user_id uuid; normalized text := lower(trim(target_identifier));
begin
  select organization_id into target_organization_id from public.members
  where user_id = auth.uid() and role::text = 'admin' order by created_at limit 1;
  if target_organization_id is null then raise exception 'Administrator permission required'; end if;
  if target_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;
  select profile.user_id into matched_user_id from public.user_profiles profile
  where lower(profile.username) = normalized or lower(coalesce(profile.contact_email, '')) = normalized
  order by case when lower(profile.username) = normalized then 0 else 1 end limit 1;
  if matched_user_id is null then
    select id into matched_user_id from auth.users where lower(coalesce(email, '')) = normalized limit 1;
  end if;
  if matched_user_id is null then raise exception 'Account not found'; end if;
  if exists (select 1 from public.household_members where organization_id = target_organization_id and auth_user_id = matched_user_id and id <> target_member_id) then
    raise exception 'Account already linked';
  end if;
  insert into public.members (organization_id, user_id, role)
  values (target_organization_id, matched_user_id, target_role::public.member_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;
  delete from public.removed_organization_users where organization_id = target_organization_id and user_id = matched_user_id;
  update public.household_members set auth_user_id = matched_user_id, updated_at = now()
  where id = target_member_id and organization_id = target_organization_id;
  if not found then raise exception 'Member not found'; end if;
  return matched_user_id;
end;
$$;

create or replace function public.unlink_household_member_account(target_member_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid; linked_user_id uuid;
begin
  select organization_id into target_organization_id from public.members
  where user_id = auth.uid() and role::text = 'admin' order by created_at limit 1;
  if target_organization_id is null then raise exception 'Administrator permission required'; end if;
  select auth_user_id into linked_user_id from public.household_members
  where id = target_member_id and organization_id = target_organization_id;
  if linked_user_id = auth.uid() then raise exception 'You cannot unlink yourself'; end if;
  update public.household_members set auth_user_id = null, updated_at = now()
  where id = target_member_id and organization_id = target_organization_id;
  if linked_user_id is not null then
    delete from public.members where organization_id = target_organization_id and user_id = linked_user_id;
  end if;
end;
$$;

create or replace function public.archive_household_member(target_member_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid; linked_user_id uuid;
begin
  select organization_id into target_organization_id from public.members
  where user_id = auth.uid() and role::text = 'admin' order by created_at limit 1;
  if target_organization_id is null then raise exception 'Administrator permission required'; end if;
  select auth_user_id into linked_user_id from public.household_members
  where id = target_member_id and organization_id = target_organization_id;
  if linked_user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  update public.household_members set is_active = false, auth_user_id = null, updated_at = now()
  where id = target_member_id and organization_id = target_organization_id;
  if not found then raise exception 'Member not found'; end if;
  if linked_user_id is not null then delete from public.members where organization_id = target_organization_id and user_id = linked_user_id; end if;
end;
$$;

create or replace function public.save_household_expense(
  target_expense_id uuid,
  target_property_id uuid,
  target_category text,
  target_amount numeric,
  target_expense_date date,
  target_payer_member_id uuid,
  target_participant_ids uuid[],
  target_status text default 'completed',
  target_reference_code text default null,
  target_note text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid; saved_expense_id uuid; participant_id uuid; participant_count integer;
begin
  select organization_id into target_organization_id from public.members where user_id = auth.uid() order by created_at limit 1;
  if target_organization_id is null then raise exception 'Membership required'; end if;
  participant_count := coalesce(array_length(target_participant_ids, 1), 0);
  if target_amount <= 0 or participant_count = 0 then raise exception 'Invalid expense'; end if;
  if not exists (
    select 1 from public.household_members profile
    where profile.id = target_payer_member_id
      and profile.organization_id = target_organization_id
      and profile.is_active
      and not exists (
        select 1 from public.members access
        where access.organization_id = profile.organization_id
          and access.user_id = profile.auth_user_id
          and access.role::text = 'admin'
      )
  ) then raise exception 'Payer is not a chargeable member'; end if;
  if target_expense_id is null then
    insert into public.expenses (organization_id, property_id, category, amount, expense_date, note, payer_member_id, status, reference_code)
    values (target_organization_id, target_property_id, trim(target_category), target_amount, target_expense_date,
            nullif(trim(target_note), ''), target_payer_member_id, target_status, nullif(trim(target_reference_code), ''))
    returning id into saved_expense_id;
  else
    update public.expenses set category = trim(target_category), amount = target_amount,
      expense_date = target_expense_date, note = nullif(trim(target_note), ''),
      payer_member_id = target_payer_member_id, status = target_status,
      reference_code = nullif(trim(target_reference_code), '')
    where id = target_expense_id and organization_id = target_organization_id returning id into saved_expense_id;
    if saved_expense_id is null then raise exception 'Expense not found'; end if;
    delete from public.expense_member_participants where expense_id = saved_expense_id;
  end if;
  foreach participant_id in array target_participant_ids loop
    if not exists (
      select 1 from public.household_members profile
      where profile.id = participant_id
        and profile.organization_id = target_organization_id
        and profile.is_active
        and not exists (
          select 1 from public.members access
          where access.organization_id = profile.organization_id
            and access.user_id = profile.auth_user_id
            and access.role::text = 'admin'
        )
    ) then raise exception 'Participant is not a chargeable member'; end if;
    insert into public.expense_member_participants (expense_id, organization_id, member_id, allocated_amount)
    values (saved_expense_id, target_organization_id, participant_id, target_amount / participant_count);
  end loop;
  return saved_expense_id;
end;
$$;

revoke execute on function public.get_household_members() from public, anon;
revoke execute on function public.create_household_member(text, text, text, text) from public, anon;
revoke execute on function public.update_household_member(uuid, text, text, text, text) from public, anon;
revoke execute on function public.link_household_member_account(uuid, text, text) from public, anon;
revoke execute on function public.unlink_household_member_account(uuid) from public, anon;
revoke execute on function public.archive_household_member(uuid) from public, anon;
revoke execute on function public.save_household_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.get_household_members() to authenticated;
grant execute on function public.create_household_member(text, text, text, text) to authenticated;
grant execute on function public.update_household_member(uuid, text, text, text, text) to authenticated;
grant execute on function public.link_household_member_account(uuid, text, text) to authenticated;
grant execute on function public.unlink_household_member_account(uuid) to authenticated;
grant execute on function public.archive_household_member(uuid) to authenticated;
grant execute on function public.save_household_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) to authenticated;

-- New accounts no longer join the house automatically. An administrator links
-- the registered account to an existing household member profile first.
create or replace function public.bootstrap_current_user()
returns uuid language plpgsql security definer set search_path = public
as $$
declare current_user_id uuid := auth.uid(); target_organization_id uuid; target_property_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select organization_id into target_organization_id from public.members
  where user_id = current_user_id order by created_at limit 1;
  if target_organization_id is null then
    if exists (select 1 from public.organizations) then
      raise exception 'Account is waiting for an administrator to link a household member';
    end if;
    insert into public.organizations (name, owner_user_id)
    values ('708 La Thành', current_user_id) returning id into target_organization_id;
    insert into public.members (organization_id, user_id, role)
    values (target_organization_id, current_user_id, 'admin');
    insert into public.household_members (organization_id, auth_user_id, full_name)
    values (
      target_organization_id,
      current_user_id,
      coalesce(
        (select nullif(profile.username, '') from public.user_profiles profile where profile.user_id = current_user_id),
        (select split_part(account.email, '@', 1) from auth.users account where account.id = current_user_id),
        'Quản trị viên'
      )
    )
    on conflict (organization_id, auth_user_id) do nothing;
  end if;
  select id into target_property_id from public.properties
  where organization_id = target_organization_id order by created_at limit 1;
  if target_property_id is null then
    insert into public.properties (organization_id, name) values (target_organization_id, '708 La Thành');
  end if;
  return target_organization_id;
end;
$$;
