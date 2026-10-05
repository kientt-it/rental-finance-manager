-- Track monthly room-rent payment status per assigned household member.
-- Run after 0019_payment_reminders.sql.

create table if not exists public.room_rent_settlements (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  financial_period_id uuid not null references public.financial_periods(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  period date not null check (date_trunc('month', period)::date = period),
  share_amount numeric(14, 2) not null default 0 check (share_amount >= 0),
  is_settled boolean not null default false,
  settled_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (property_id, room_id, member_id, period)
);

alter table public.room_rent_settlements enable row level security;

drop policy if exists "Members read room rent settlements" on public.room_rent_settlements;
create policy "Members read room rent settlements" on public.room_rent_settlements
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage room rent settlements" on public.room_rent_settlements;
create policy "Admins manage room rent settlements" on public.room_rent_settlements
  for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create index if not exists room_rent_settlements_period_idx
  on public.room_rent_settlements (financial_period_id, room_id, is_settled);
create index if not exists room_rent_settlements_member_idx
  on public.room_rent_settlements (member_id, period desc);

create or replace function public.set_room_rent_settlement(
  target_room_id uuid,
  target_member_id uuid,
  target_financial_period_id uuid,
  target_is_settled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  target_property_id uuid;
  target_period date;
  target_base_rent numeric;
  resident_count integer;
  target_share numeric;
begin
  select room.organization_id, room.property_id, room.base_rent,
         period.period_start
  into target_organization_id, target_property_id, target_base_rent,
       target_period
  from public.rooms room
  join public.financial_periods period
    on period.id = target_financial_period_id
   and period.organization_id = room.organization_id
   and period.property_id = room.property_id
  where room.id = target_room_id;

  if target_organization_id is null then
    raise exception 'Room or financial period not found';
  end if;
  if not public.is_organization_admin(target_organization_id) then
    raise exception 'Administrator permission required';
  end if;
  if not exists (
    select 1
    from public.room_member_assignments assignment
    where assignment.room_id = target_room_id
      and assignment.member_id = target_member_id
      and assignment.organization_id = target_organization_id
  ) then
    raise exception 'Member is not assigned to this room';
  end if;

  select count(*) into resident_count
  from public.room_member_assignments assignment
  where assignment.room_id = target_room_id;

  target_share := case
    when resident_count > 0 then round(target_base_rent / resident_count, 2)
    else 0
  end;

  insert into public.room_rent_settlements (
    organization_id, property_id, financial_period_id, room_id, member_id,
    period, share_amount, is_settled, settled_at, updated_by, updated_at
  ) values (
    target_organization_id, target_property_id, target_financial_period_id,
    target_room_id, target_member_id, target_period, target_share,
    target_is_settled,
    case when target_is_settled then now() else null end,
    auth.uid(), now()
  )
  on conflict (property_id, room_id, member_id, period) do update set
    financial_period_id = excluded.financial_period_id,
    share_amount = excluded.share_amount,
    is_settled = excluded.is_settled,
    settled_at = excluded.settled_at,
    updated_by = auth.uid(),
    updated_at = now();

  update public.financial_periods
  set exported_at = null, updated_at = now()
  where id = target_financial_period_id;
end;
$$;

revoke all on function public.set_room_rent_settlement(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_room_rent_settlement(uuid, uuid, uuid, boolean) to authenticated;

-- Include unpaid room rent and unpaid shared expenses in one reminder per member.
create or replace function public.get_payment_reminder_candidates()
returns table (
  organization_id uuid,
  property_id uuid,
  period_start date,
  due_date date,
  member_id uuid,
  auth_user_id uuid,
  member_name text,
  recipient_email text,
  amount numeric,
  items text,
  reminder_type text,
  in_app_enabled boolean,
  email_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_vn date := timezone('Asia/Ho_Chi_Minh', now())::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.financial_periods period
  set is_default = false, updated_at = now()
  where period.is_default
    and period.property_id in (select setting.property_id from public.payment_reminder_settings setting where setting.enabled)
    and period.period_start <> date_trunc('month', today_vn)::date;

  insert into public.financial_periods (organization_id, property_id, period_start, is_default)
  select setting.organization_id, setting.property_id, date_trunc('month', today_vn)::date, true
  from public.payment_reminder_settings setting
  join public.properties property
    on property.id = setting.property_id and property.organization_id = setting.organization_id
  where setting.enabled
  on conflict (property_id, period_start) do update
    set is_default = true, updated_at = now();

  return query
  with active_periods as (
    select setting.organization_id, setting.property_id, period.id as period_id,
           period.period_start, setting.in_app_enabled, setting.email_enabled,
           setting.settlement_due_day, setting.reminder_before_days,
           setting.reminder_on_due_date, setting.reminder_after_days,
           least(
             setting.settlement_due_day::integer,
             extract(day from (date_trunc('month', today_vn) + interval '1 month - 1 day'))::integer
           ) as due_day
    from public.payment_reminder_settings setting
    join public.properties property
      on property.id = setting.property_id and property.organization_id = setting.organization_id
    join public.financial_periods period
      on period.property_id = setting.property_id
     and period.period_start = date_trunc('month', today_vn)::date
    where setting.enabled
  ),
  allocated as (
    select expense.financial_period_id, participant.member_id,
           sum(participant.allocated_amount)::numeric as allocated_amount,
           string_agg(distinct nullif(trim(expense.category), ''), ', ' order by nullif(trim(expense.category), '')) as categories
    from public.expenses expense
    join public.expense_member_participants participant on participant.expense_id = expense.id
    join active_periods active on active.period_id = expense.financial_period_id
    where expense.status <> 'cancelled'
    group by expense.financial_period_id, participant.member_id
  ),
  advanced as (
    select expense.financial_period_id, expense.payer_member_id as member_id,
           sum(expense.amount)::numeric as advanced_amount
    from public.expenses expense
    join active_periods active on active.period_id = expense.financial_period_id
    where expense.status <> 'cancelled' and expense.payer_member_id is not null
    group by expense.financial_period_id, expense.payer_member_id
  ),
  expense_dues as (
    select active.organization_id, active.property_id, active.period_id,
           active.period_start, allocation.member_id,
           greatest(allocation.allocated_amount - coalesce(payment.advanced_amount, 0), 0)::numeric as amount,
           'Chi phí sinh hoạt: ' || coalesce(nullif(allocation.categories, ''), 'các khoản trong kỳ') as items
    from active_periods active
    join allocated allocation on allocation.financial_period_id = active.period_id
    left join advanced payment
      on payment.financial_period_id = active.period_id
     and payment.member_id = allocation.member_id
    left join public.household_member_settlements settlement
      on settlement.financial_period_id = active.period_id
     and settlement.member_id = allocation.member_id
    where not coalesce(settlement.is_settled, false)
      and greatest(allocation.allocated_amount - coalesce(payment.advanced_amount, 0), 0) > 0
  ),
  room_allocations as (
    select active.organization_id, active.property_id, active.period_id,
           active.period_start, room.id as room_id, assignment.member_id,
           round(room.base_rent / nullif(count(*) over (partition by room.id), 0), 2)::numeric as amount,
           'Tiền phòng ' || room.code as items
    from active_periods active
    join public.rooms room
      on room.property_id = active.property_id
     and room.organization_id = active.organization_id
    join public.room_member_assignments assignment
      on assignment.room_id = room.id
     and assignment.organization_id = active.organization_id
    where room.base_rent > 0
  ),
  room_dues as (
    select allocation.organization_id, allocation.property_id, allocation.period_id,
           allocation.period_start, allocation.member_id, allocation.amount, allocation.items
    from room_allocations allocation
    left join public.room_rent_settlements settlement
      on settlement.financial_period_id = allocation.period_id
     and settlement.room_id = allocation.room_id
     and settlement.member_id = allocation.member_id
    where not coalesce(settlement.is_settled, false)
      and allocation.amount > 0
  ),
  all_dues as (
    select * from expense_dues
    union all
    select * from room_dues
  ),
  member_dues as (
    select due.organization_id, due.property_id, due.period_id, due.period_start,
           due.member_id, sum(due.amount)::numeric as amount,
           string_agg(due.items, '; ' order by due.items) as items
    from all_dues due
    group by due.organization_id, due.property_id, due.period_id, due.period_start, due.member_id
  ),
  candidates as (
    select active.organization_id, active.property_id, active.period_start,
           (active.period_start + (active.due_day - 1))::date as due_date,
           member.id as member_id, member.auth_user_id,
           member.full_name as member_name,
           coalesce(nullif(trim(profile.contact_email), ''), account.email, '') as recipient_email,
           due.amount, due.items,
           case
             when active.reminder_before_days = ((active.period_start + (active.due_day - 1))::date - today_vn) then 'before'
             when active.reminder_on_due_date and today_vn = (active.period_start + (active.due_day - 1))::date then 'due'
             when active.reminder_after_days = (today_vn - (active.period_start + (active.due_day - 1))::date) then 'overdue'
           end as reminder_type,
           active.in_app_enabled, active.email_enabled
    from active_periods active
    join member_dues due
      on due.period_id = active.period_id
    join public.household_members member
      on member.id = due.member_id
     and member.organization_id = active.organization_id
     and member.is_active
    left join public.user_profiles profile on profile.user_id = member.auth_user_id
    left join auth.users account on account.id = member.auth_user_id
  )
  select candidate.organization_id, candidate.property_id, candidate.period_start,
         candidate.due_date, candidate.member_id, candidate.auth_user_id,
         candidate.member_name, candidate.recipient_email,
         candidate.amount, candidate.items, candidate.reminder_type,
         candidate.in_app_enabled, candidate.email_enabled
  from candidates candidate
  where candidate.reminder_type is not null
    and candidate.auth_user_id is not null
    and candidate.amount > 0
    and candidate.recipient_email <> ''
    and candidate.recipient_email not like '%@users.708.local';
end;
$$;

revoke all on function public.get_payment_reminder_candidates() from public, anon, authenticated;
grant execute on function public.get_payment_reminder_candidates() to service_role;
