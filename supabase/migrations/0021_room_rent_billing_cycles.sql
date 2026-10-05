-- Configure room-rent billing cycles and allow members to confirm only their own payment.
-- Run after 0020_room_rent_settlements.sql.

alter table public.rooms
  add column if not exists rent_billing_cycle_months integer not null default 1;

alter table public.rooms
  add column if not exists rent_cycle_start_month date;

update public.rooms
set rent_cycle_start_month = date_trunc('month', created_at)::date
where rent_cycle_start_month is null;

alter table public.rooms
  alter column rent_cycle_start_month set default date_trunc('month', current_date)::date,
  alter column rent_cycle_start_month set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_rent_billing_cycle_months_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_rent_billing_cycle_months_check
      check (rent_billing_cycle_months in (1, 3, 6, 12));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_rent_cycle_start_month_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_rent_cycle_start_month_check
      check (date_trunc('month', rent_cycle_start_month)::date = rent_cycle_start_month);
  end if;
end;
$$;

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
  target_cycle_months integer;
  target_cycle_start date;
  target_month_offset integer;
  resident_count integer;
  target_share numeric;
begin
  select room.organization_id, room.property_id, room.base_rent,
         room.rent_billing_cycle_months, room.rent_cycle_start_month,
         period.period_start
  into target_organization_id, target_property_id, target_base_rent,
       target_cycle_months, target_cycle_start, target_period
  from public.rooms room
  join public.financial_periods period
    on period.id = target_financial_period_id
   and period.organization_id = room.organization_id
   and period.property_id = room.property_id
  where room.id = target_room_id;

  if target_organization_id is null then
    raise exception 'Room or financial period not found';
  end if;
  if not public.is_organization_admin(target_organization_id)
     and not exists (
       select 1
       from public.household_members member
       where member.id = target_member_id
         and member.organization_id = target_organization_id
         and member.auth_user_id = auth.uid()
         and member.is_active
     ) then
    raise exception 'Members can update only their own room-rent payment';
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

  target_month_offset :=
    (extract(year from target_period)::integer * 12 + extract(month from target_period)::integer)
    - (extract(year from target_cycle_start)::integer * 12 + extract(month from target_cycle_start)::integer);
  if target_month_offset < 0 or mod(target_month_offset, target_cycle_months) <> 0 then
    raise exception 'This financial period is not a room-rent due period';
  end if;

  select count(*) into resident_count
  from public.room_member_assignments assignment
  where assignment.room_id = target_room_id
    and assignment.organization_id = target_organization_id;

  target_share := case
    when resident_count > 0 then round((target_base_rent * target_cycle_months) / resident_count, 2)
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

-- Include rent only in months that match each room's configured billing cycle.
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
           round((room.base_rent * room.rent_billing_cycle_months) / nullif(count(*) over (partition by room.id), 0), 2)::numeric as amount,
           'Tiền phòng ' || room.code || case when room.rent_billing_cycle_months = 1 then '' else ' (' || room.rent_billing_cycle_months || ' tháng)' end as items
    from active_periods active
    join public.rooms room
      on room.property_id = active.property_id
     and room.organization_id = active.organization_id
    join public.room_member_assignments assignment
      on assignment.room_id = room.id
     and assignment.organization_id = active.organization_id
    where room.base_rent > 0
      and (
        (extract(year from active.period_start)::integer * 12 + extract(month from active.period_start)::integer)
        - (extract(year from room.rent_cycle_start_month)::integer * 12 + extract(month from room.rent_cycle_start_month)::integer)
      ) >= 0
      and mod(
        (extract(year from active.period_start)::integer * 12 + extract(month from active.period_start)::integer)
        - (extract(year from room.rent_cycle_start_month)::integer * 12 + extract(month from room.rent_cycle_start_month)::integer),
        room.rent_billing_cycle_months
      ) = 0
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
