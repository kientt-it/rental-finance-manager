-- Monthly financial periods, period-scoped expenses and safe archival cleanup.
-- Run after 0012_self_service_account_profile.sql.

create table if not exists public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  period_start date not null check (date_trunc('month', period_start)::date = period_start),
  status text not null default 'open' check (status in ('open', 'closed')),
  exported_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, period_start)
);

alter table public.financial_periods enable row level security;

drop policy if exists "Members read financial periods" on public.financial_periods;
create policy "Members read financial periods" on public.financial_periods for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage financial periods" on public.financial_periods;
create policy "Admins manage financial periods" on public.financial_periods for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create index if not exists financial_periods_property_start_idx
  on public.financial_periods (property_id, period_start desc);

-- Preserve existing history and make the current calendar month immediately available.
insert into public.financial_periods (organization_id, property_id, period_start)
select distinct expense.organization_id, expense.property_id,
       date_trunc('month', expense.expense_date)::date
from public.expenses expense
on conflict (property_id, period_start) do nothing;

insert into public.financial_periods (organization_id, property_id, period_start)
select distinct settlement.organization_id, settlement.property_id, settlement.period
from public.household_member_settlements settlement
on conflict (property_id, period_start) do nothing;

insert into public.financial_periods (organization_id, property_id, period_start)
select property.organization_id, property.id, date_trunc('month', current_date)::date
from public.properties property
on conflict (property_id, period_start) do nothing;

alter table public.expenses
  add column if not exists financial_period_id uuid references public.financial_periods(id) on delete cascade;

update public.expenses expense
set financial_period_id = period.id
from public.financial_periods period
where expense.financial_period_id is null
  and period.property_id = expense.property_id
  and period.period_start = date_trunc('month', expense.expense_date)::date;

alter table public.expenses alter column financial_period_id set not null;
create index if not exists expenses_financial_period_idx on public.expenses (financial_period_id, expense_date desc);

alter table public.household_member_settlements
  add column if not exists financial_period_id uuid references public.financial_periods(id) on delete cascade;

update public.household_member_settlements settlement
set financial_period_id = financial_period.id
from public.financial_periods financial_period
where settlement.financial_period_id is null
  and financial_period.property_id = settlement.property_id
  and financial_period.period_start = settlement.period;

alter table public.household_member_settlements alter column financial_period_id set not null;
create index if not exists household_settlements_financial_period_idx
  on public.household_member_settlements (financial_period_id);

create or replace function public.get_financial_periods(target_property_id uuid)
returns table (
  id uuid,
  period_start date,
  status text,
  exported_at timestamptz,
  expense_count bigint,
  total_amount numeric
)
language sql stable security definer set search_path = public
as $$
  select period.id, period.period_start, period.status, period.exported_at,
         count(expense.id), coalesce(sum(expense.amount), 0)
  from public.financial_periods period
  left join public.expenses expense on expense.financial_period_id = period.id
  where period.property_id = target_property_id
    and public.is_organization_member(period.organization_id)
  group by period.id
  order by period.period_start desc;
$$;

create or replace function public.create_financial_period(target_property_id uuid, target_period_start date)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_organization_id uuid;
  normalized_start date := date_trunc('month', target_period_start)::date;
  saved_id uuid;
begin
  select property.organization_id into target_organization_id
  from public.properties property where property.id = target_property_id;
  if target_organization_id is null then raise exception 'Property not found'; end if;
  if not public.is_organization_admin(target_organization_id) then raise exception 'Administrator permission required'; end if;

  insert into public.financial_periods (organization_id, property_id, period_start, created_by)
  values (target_organization_id, target_property_id, normalized_start, auth.uid())
  on conflict (property_id, period_start) do update set updated_at = now()
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.set_financial_period_status(target_period_id uuid, target_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid;
begin
  if target_status not in ('open', 'closed') then raise exception 'Invalid period status'; end if;
  select organization_id into target_organization_id from public.financial_periods where id = target_period_id;
  if not public.is_organization_admin(target_organization_id) then raise exception 'Administrator permission required'; end if;
  update public.financial_periods set status = target_status, updated_at = now() where id = target_period_id;
end;
$$;

create or replace function public.mark_financial_period_exported(target_period_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id from public.financial_periods where id = target_period_id;
  if not public.is_organization_admin(target_organization_id) then raise exception 'Administrator permission required'; end if;
  update public.financial_periods set exported_at = now(), updated_at = now() where id = target_period_id;
end;
$$;

create or replace function public.mark_financial_period_dirty(target_period_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id from public.financial_periods where id = target_period_id;
  if not public.is_organization_member(target_organization_id) then raise exception 'Membership required'; end if;
  update public.financial_periods set exported_at = null, updated_at = now() where id = target_period_id;
end;
$$;

create or replace function public.delete_financial_period(target_period_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_organization_id uuid;
  last_exported_at timestamptz;
  target_property_id uuid;
  target_period_start date;
begin
  select organization_id, exported_at, property_id, period_start
  into target_organization_id, last_exported_at, target_property_id, target_period_start
  from public.financial_periods where id = target_period_id;
  if target_organization_id is null then raise exception 'Financial period not found'; end if;
  if not public.is_organization_admin(target_organization_id) then raise exception 'Administrator permission required'; end if;
  if last_exported_at is null then raise exception 'Export the period before deleting it'; end if;
  -- Remove legacy rows that were migrated to the household-member model as well.
  delete from public.member_settlements where property_id = target_property_id and period = target_period_start;
  delete from public.shared_expense_settlements where property_id = target_property_id and period = target_period_start;
  delete from public.shared_expenses where property_id = target_property_id and period = target_period_start;
  delete from public.financial_periods where id = target_period_id;
end;
$$;

-- The expense write API now requires an explicit financial period.
drop function if exists public.save_household_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text);
drop function if exists public.save_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text);

create or replace function public.save_household_expense(
  target_expense_id uuid,
  target_property_id uuid,
  target_financial_period_id uuid,
  target_category text,
  target_amount numeric,
  target_expense_date date,
  target_payer_member_id uuid,
  target_participant_ids uuid[],
  target_status text,
  target_reference_code text default null,
  target_note text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_organization_id uuid;
  selected_period_start date;
  selected_period_status text;
  saved_expense_id uuid;
  participant_id uuid;
  participant_count integer;
begin
  select organization_id into target_organization_id
  from public.members where user_id = auth.uid() order by created_at limit 1;
  if target_organization_id is null then raise exception 'Membership required'; end if;
  if target_status not in ('pending', 'completed') then raise exception 'Invalid status'; end if;
  participant_count := coalesce(array_length(target_participant_ids, 1), 0);
  if target_amount <= 0 or participant_count = 0 then raise exception 'Invalid expense'; end if;

  select period_start, status into selected_period_start, selected_period_status
  from public.financial_periods
  where id = target_financial_period_id
    and property_id = target_property_id
    and organization_id = target_organization_id;
  if selected_period_start is null then raise exception 'Financial period not found'; end if;
  if selected_period_status <> 'open' then raise exception 'Financial period is closed'; end if;
  if target_expense_date < selected_period_start or target_expense_date >= (selected_period_start + interval '1 month')::date then
    raise exception 'Expense date must be inside the financial period';
  end if;

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
    insert into public.expenses (
      organization_id, property_id, financial_period_id, category, amount, expense_date,
      note, payer_member_id, status, reference_code
    ) values (
      target_organization_id, target_property_id, target_financial_period_id,
      trim(target_category), target_amount, target_expense_date, nullif(trim(target_note), ''),
      target_payer_member_id, target_status, nullif(trim(target_reference_code), '')
    ) returning id into saved_expense_id;
  else
    update public.expenses set
      financial_period_id = target_financial_period_id,
      category = trim(target_category), amount = target_amount,
      expense_date = target_expense_date, note = nullif(trim(target_note), ''),
      payer_member_id = target_payer_member_id, status = target_status,
      reference_code = nullif(trim(target_reference_code), '')
    where id = target_expense_id and organization_id = target_organization_id
    returning id into saved_expense_id;
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
  update public.financial_periods set exported_at = null, updated_at = now() where id = target_financial_period_id;
  return saved_expense_id;
end;
$$;

revoke execute on function public.get_financial_periods(uuid) from public, anon;
revoke execute on function public.create_financial_period(uuid, date) from public, anon;
revoke execute on function public.set_financial_period_status(uuid, text) from public, anon;
revoke execute on function public.mark_financial_period_exported(uuid) from public, anon;
revoke execute on function public.mark_financial_period_dirty(uuid) from public, anon;
revoke execute on function public.delete_financial_period(uuid) from public, anon;
revoke execute on function public.save_household_expense(uuid, uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) from public, anon;

grant execute on function public.get_financial_periods(uuid) to authenticated;
grant execute on function public.create_financial_period(uuid, date) to authenticated;
grant execute on function public.set_financial_period_status(uuid, text) to authenticated;
grant execute on function public.mark_financial_period_exported(uuid) to authenticated;
grant execute on function public.mark_financial_period_dirty(uuid) to authenticated;
grant execute on function public.delete_financial_period(uuid) to authenticated;
grant execute on function public.save_household_expense(uuid, uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) to authenticated;
