-- Fix the ambiguous conflict target in the payment reminder candidate function.
-- Run after 0022_split_rent_and_living_reminders.sql. No data or settings are changed.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.financial_periods'::regclass
      and conname = 'financial_periods_property_id_period_start_key'
  ) then
    raise exception 'Missing financial_periods property/period unique constraint';
  end if;
end;
$$;

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
  reminder_scope text,
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
    and period.property_id in (
      select setting.property_id
      from public.payment_reminder_settings setting
      where setting.enabled or setting.rent_enabled
    )
    and period.period_start <> date_trunc('month', today_vn)::date;

  insert into public.financial_periods (organization_id, property_id, period_start, is_default)
  select setting.organization_id, setting.property_id, date_trunc('month', today_vn)::date, true
  from public.payment_reminder_settings setting
  join public.properties property
    on property.id = setting.property_id and property.organization_id = setting.organization_id
  where setting.enabled or setting.rent_enabled
  on conflict on constraint financial_periods_property_id_period_start_key do update
    set is_default = true, updated_at = now();

  return query
  with active_periods as (
    select setting.*, period.id as period_id, period.period_start
    from public.payment_reminder_settings setting
    join public.properties property
      on property.id = setting.property_id and property.organization_id = setting.organization_id
    join public.financial_periods period
      on period.property_id = setting.property_id
     and period.period_start = date_trunc('month', today_vn)::date
    where setting.enabled or setting.rent_enabled
  ),
  living_periods as (
    select active.*,
           least(
             active.settlement_due_day::integer,
             extract(day from (date_trunc('month', today_vn) + interval '1 month - 1 day'))::integer
           ) as due_day
    from active_periods active
    where active.enabled
  ),
  rent_periods as (
    select active.*,
           least(
             active.rent_due_day::integer,
             extract(day from (date_trunc('month', today_vn) + interval '1 month - 1 day'))::integer
           ) as due_day
    from active_periods active
    where active.rent_enabled
  ),
  allocated as (
    select expense.financial_period_id, participant.member_id,
           sum(participant.allocated_amount)::numeric as allocated_amount,
           string_agg(distinct nullif(trim(expense.category), ''), ', ' order by nullif(trim(expense.category), '')) as categories
    from public.expenses expense
    join public.expense_member_participants participant on participant.expense_id = expense.id
    join living_periods active on active.period_id = expense.financial_period_id
    where expense.status <> 'cancelled'
    group by expense.financial_period_id, participant.member_id
  ),
  advanced as (
    select expense.financial_period_id, expense.payer_member_id as member_id,
           sum(expense.amount)::numeric as advanced_amount
    from public.expenses expense
    join living_periods active on active.period_id = expense.financial_period_id
    where expense.status <> 'cancelled' and expense.payer_member_id is not null
    group by expense.financial_period_id, expense.payer_member_id
  ),
  living_candidates as (
    select active.organization_id, active.property_id, active.period_start,
           (active.period_start + (active.due_day - 1))::date as due_date,
           member.id as member_id, member.auth_user_id,
           member.full_name as member_name,
           coalesce(nullif(trim(profile.contact_email), ''), account.email, '') as recipient_email,
           greatest(allocation.allocated_amount - coalesce(payment.advanced_amount, 0), 0)::numeric as amount,
           'Chi phí sinh hoạt: ' || coalesce(nullif(allocation.categories, ''), 'các khoản trong kỳ') as items,
           case
             when active.reminder_before_days = ((active.period_start + (active.due_day - 1))::date - today_vn) then 'before'
             when active.reminder_on_due_date and today_vn = (active.period_start + (active.due_day - 1))::date then 'due'
             when active.reminder_after_days = (today_vn - (active.period_start + (active.due_day - 1))::date) then 'overdue'
           end as reminder_type,
           'living_expense'::text as reminder_scope,
           active.in_app_enabled, active.email_enabled
    from living_periods active
    join allocated allocation on allocation.financial_period_id = active.period_id
    join public.household_members member
      on member.id = allocation.member_id
     and member.organization_id = active.organization_id
     and member.is_active
    left join public.user_profiles profile on profile.user_id = member.auth_user_id
    left join auth.users account on account.id = member.auth_user_id
    left join advanced payment
      on payment.financial_period_id = active.period_id
     and payment.member_id = allocation.member_id
    left join public.household_member_settlements settlement
      on settlement.financial_period_id = active.period_id
     and settlement.member_id = allocation.member_id
    where not coalesce(settlement.is_settled, false)
      and greatest(allocation.allocated_amount - coalesce(payment.advanced_amount, 0), 0) > 0
  ),
  rent_allocations as (
    select active.organization_id, active.property_id, active.period_id,
           active.period_start, active.due_day, active.rent_reminder_before_days,
           active.rent_reminder_on_due_date, active.rent_reminder_after_days,
           active.rent_in_app_enabled, active.rent_email_enabled,
           room.id as room_id, assignment.member_id,
           round((room.base_rent * room.rent_billing_cycle_months) / nullif(count(*) over (partition by room.id), 0), 2)::numeric as amount,
           'Tiền phòng ' || room.code || case when room.rent_billing_cycle_months = 1 then '' else ' (' || room.rent_billing_cycle_months || ' tháng)' end as items
    from rent_periods active
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
  unpaid_rent as (
    select allocation.*
    from rent_allocations allocation
    left join public.room_rent_settlements settlement
      on settlement.financial_period_id = allocation.period_id
     and settlement.room_id = allocation.room_id
     and settlement.member_id = allocation.member_id
    where not coalesce(settlement.is_settled, false)
      and allocation.amount > 0
  ),
  rent_member_dues as (
    select due.organization_id, due.property_id, due.period_id, due.period_start,
           due.due_day, due.rent_reminder_before_days, due.rent_reminder_on_due_date,
           due.rent_reminder_after_days, due.rent_in_app_enabled, due.rent_email_enabled,
           due.member_id, sum(due.amount)::numeric as amount,
           string_agg(due.items, '; ' order by due.items) as items
    from unpaid_rent due
    group by due.organization_id, due.property_id, due.period_id, due.period_start,
             due.due_day, due.rent_reminder_before_days, due.rent_reminder_on_due_date,
             due.rent_reminder_after_days, due.rent_in_app_enabled, due.rent_email_enabled,
             due.member_id
  ),
  rent_candidates as (
    select due.organization_id, due.property_id, due.period_start,
           (due.period_start + (due.due_day - 1))::date as due_date,
           member.id as member_id, member.auth_user_id,
           member.full_name as member_name,
           coalesce(nullif(trim(profile.contact_email), ''), account.email, '') as recipient_email,
           due.amount, due.items,
           case
             when due.rent_reminder_before_days = ((due.period_start + (due.due_day - 1))::date - today_vn) then 'before'
             when due.rent_reminder_on_due_date and today_vn = (due.period_start + (due.due_day - 1))::date then 'due'
             when due.rent_reminder_after_days = (today_vn - (due.period_start + (due.due_day - 1))::date) then 'overdue'
           end as reminder_type,
           'rent'::text as reminder_scope,
           due.rent_in_app_enabled as in_app_enabled,
           due.rent_email_enabled as email_enabled
    from rent_member_dues due
    join public.household_members member
      on member.id = due.member_id
     and member.organization_id = due.organization_id
     and member.is_active
    left join public.user_profiles profile on profile.user_id = member.auth_user_id
    left join auth.users account on account.id = member.auth_user_id
  ),
  candidates as (
    select * from living_candidates
    union all
    select * from rent_candidates
  )
  select candidate.organization_id, candidate.property_id, candidate.period_start,
         candidate.due_date, candidate.member_id, candidate.auth_user_id,
         candidate.member_name, candidate.recipient_email,
         candidate.amount, candidate.items, candidate.reminder_type,
         candidate.reminder_scope, candidate.in_app_enabled, candidate.email_enabled
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
