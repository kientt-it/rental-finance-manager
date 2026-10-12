-- Separate exact send days for monthly living costs and rent-cycle reminders.
-- Apply after 0023_fix_payment_reminder_conflict_target.sql.
-- Existing properties retain their approximate previous first-reminder day.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_reminder_settings' and column_name = 'living_send_day'
  ) then
    alter table public.payment_reminder_settings
      add column living_send_day smallint not null default 2 check (living_send_day between 0 and 31);
    update public.payment_reminder_settings
    set living_send_day = case when settlement_due_day > 1 then greatest(1, settlement_due_day - reminder_before_days) else 0 end;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_reminder_settings' and column_name = 'rent_send_day'
  ) then
    alter table public.payment_reminder_settings
      add column rent_send_day smallint not null default 2 check (rent_send_day between 0 and 31);
    update public.payment_reminder_settings
    set rent_send_day = case when rent_due_day > 1 then greatest(1, rent_due_day - rent_reminder_before_days) else 0 end;
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
             when active.living_send_day > 0 and active.due_day > 1
              and today_vn = (active.period_start + (least(active.living_send_day::integer, active.due_day - 1) - 1))::date then 'before'
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
           active.period_start, active.due_day, active.rent_send_day, active.rent_reminder_before_days,
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
           due.due_day, due.rent_send_day, due.rent_reminder_before_days, due.rent_reminder_on_due_date,
           due.rent_reminder_after_days, due.rent_in_app_enabled, due.rent_email_enabled,
           due.member_id, sum(due.amount)::numeric as amount,
           string_agg(due.items, '; ' order by due.items) as items
    from unpaid_rent due
    group by due.organization_id, due.property_id, due.period_id, due.period_start,
             due.due_day, due.rent_send_day, due.rent_reminder_before_days, due.rent_reminder_on_due_date,
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
             when due.rent_send_day > 0 and due.due_day > 1
              and today_vn = (due.period_start + (least(due.rent_send_day::integer, due.due_day - 1) - 1))::date then 'before'
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

-- Read-only admin audit: show every active member, including people excluded
-- before an email event can be created. The calculation mirrors the sender.
create or replace function public.get_payment_reminder_recipient_audit(target_property_id uuid)
returns table (
  member_id uuid,
  member_name text,
  recipient_email text,
  reminder_scope text,
  amount numeric,
  send_date date,
  due_date date,
  status_code text,
  last_email_status text,
  last_email_error text,
  last_event_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  with context as (
    select setting.*,
           date_trunc('month', timezone('Asia/Ho_Chi_Minh', now()))::date as current_period,
           timezone('Asia/Ho_Chi_Minh', now())::date as today_vn,
           period.id as financial_period_id,
           least(setting.settlement_due_day::integer,
             extract(day from (date_trunc('month', timezone('Asia/Ho_Chi_Minh', now())) + interval '1 month - 1 day'))::integer) as living_due_day,
           least(setting.rent_due_day::integer,
             extract(day from (date_trunc('month', timezone('Asia/Ho_Chi_Minh', now())) + interval '1 month - 1 day'))::integer) as rent_actual_due_day
    from public.payment_reminder_settings setting
    join public.properties property on property.id = setting.property_id and property.organization_id = setting.organization_id
    left join public.financial_periods period
      on period.property_id = setting.property_id
     and period.period_start = date_trunc('month', timezone('Asia/Ho_Chi_Minh', now()))::date
    where setting.property_id = target_property_id
      and public.is_organization_admin(setting.organization_id)
  ),
  people as (
    select member.id, member.full_name, member.auth_user_id,
           coalesce(nullif(trim(profile.contact_email), ''), account.email, '')::text as email
    from context ctx
    join public.household_members member on member.organization_id = ctx.organization_id and member.is_active
    left join public.user_profiles profile on profile.user_id = member.auth_user_id
    left join auth.users account on account.id = member.auth_user_id
  ),
  living_allocated as (
    select participant.member_id, sum(participant.allocated_amount)::numeric as allocated_amount
    from context ctx
    join public.expenses expense on expense.financial_period_id = ctx.financial_period_id and expense.status <> 'cancelled'
    join public.expense_member_participants participant on participant.expense_id = expense.id
    group by participant.member_id
  ),
  living_advanced as (
    select expense.payer_member_id as member_id, sum(expense.amount)::numeric as advanced_amount
    from context ctx
    join public.expenses expense on expense.financial_period_id = ctx.financial_period_id
    where expense.status <> 'cancelled' and expense.payer_member_id is not null
    group by expense.payer_member_id
  ),
  room_shares as (
    select assignment.member_id, room.id as room_id,
           round((room.base_rent * room.rent_billing_cycle_months) /
             nullif(count(*) over (partition by room.id), 0), 2)::numeric as share_amount,
           (
             (extract(year from ctx.current_period)::integer * 12 + extract(month from ctx.current_period)::integer)
             - (extract(year from room.rent_cycle_start_month)::integer * 12 + extract(month from room.rent_cycle_start_month)::integer)
           ) >= 0 and mod(
             (extract(year from ctx.current_period)::integer * 12 + extract(month from ctx.current_period)::integer)
             - (extract(year from room.rent_cycle_start_month)::integer * 12 + extract(month from room.rent_cycle_start_month)::integer),
             room.rent_billing_cycle_months
           ) = 0 as in_cycle
    from context ctx
    join public.rooms room on room.property_id = ctx.property_id and room.organization_id = ctx.organization_id
    join public.room_member_assignments assignment on assignment.room_id = room.id and assignment.organization_id = ctx.organization_id
    where room.base_rent > 0
  ),
  rent_totals as (
    select share.member_id,
           count(*)::integer as assigned_rooms,
           count(*) filter (where share.in_cycle)::integer as due_rooms,
           coalesce(sum(share.share_amount) filter (where share.in_cycle and not coalesce(settlement.is_settled, false)), 0)::numeric as unpaid_amount
    from room_shares share
    cross join context ctx
    left join public.room_rent_settlements settlement
      on settlement.financial_period_id = ctx.financial_period_id
     and settlement.room_id = share.room_id and settlement.member_id = share.member_id
    group by share.member_id
  )
  select person.id, person.full_name, person.email, channel.scope,
         plan.amount, plan.send_date, plan.due_date,
         case
           when not plan.enabled then 'disabled'
           when person.auth_user_id is null then 'unlinked'
           when person.email = '' or person.email like '%@users.708.local' then 'no_email'
           when channel.scope = 'living_expense' and living.allocated_amount is null then 'no_expense'
           when channel.scope = 'rent' and coalesce(rent.assigned_rooms, 0) = 0 then 'no_room'
           when channel.scope = 'rent' and coalesce(rent.due_rooms, 0) = 0 then 'not_cycle'
           when plan.amount <= 0 then 'paid'
           when not plan.email_enabled then 'email_off'
           when plan.today_vn = plan.send_date
             or (plan.on_due_date and plan.today_vn = plan.due_date)
             or plan.today_vn = plan.due_date + plan.after_days then 'ready'
           when plan.today_vn < plan.due_date + plan.after_days then 'scheduled'
           else 'outside_window'
         end as status_code,
         event.email_status, event.email_error, event.created_at
  from context ctx
  join people person on true
  cross join (values ('living_expense'::text), ('rent'::text)) as channel(scope)
  left join living_allocated living on living.member_id = person.id
  left join living_advanced advanced on advanced.member_id = person.id
  left join public.household_member_settlements living_settlement
    on living_settlement.financial_period_id = ctx.financial_period_id and living_settlement.member_id = person.id
  left join rent_totals rent on rent.member_id = person.id
  cross join lateral (
    select case when channel.scope = 'rent' then rent.unpaid_amount
                when coalesce(living_settlement.is_settled, false) then 0
                else greatest(coalesce(living.allocated_amount, 0) - coalesce(advanced.advanced_amount, 0), 0) end::numeric as amount,
           (ctx.current_period + (case when channel.scope = 'rent' then ctx.rent_actual_due_day else ctx.living_due_day end) - 1)::date as due_date,
           case when channel.scope = 'rent' then ctx.rent_enabled else ctx.enabled end as enabled,
           case when channel.scope = 'rent' then ctx.rent_email_enabled else ctx.email_enabled end as email_enabled,
           case when channel.scope = 'rent' then ctx.rent_reminder_on_due_date else ctx.reminder_on_due_date end as on_due_date,
           case when channel.scope = 'rent' then ctx.rent_reminder_after_days else ctx.reminder_after_days end::integer as after_days,
           ctx.today_vn,
           case
             when channel.scope = 'rent' and ctx.rent_send_day > 0 and ctx.rent_actual_due_day > 1
               then (ctx.current_period + least(ctx.rent_send_day::integer, ctx.rent_actual_due_day - 1) - 1)::date
             when channel.scope = 'living_expense' and ctx.living_send_day > 0 and ctx.living_due_day > 1
               then (ctx.current_period + least(ctx.living_send_day::integer, ctx.living_due_day - 1) - 1)::date
             else null::date
           end as send_date
  ) plan
  left join lateral (
    select history.email_status, history.email_error, coalesce(history.sent_at, history.created_at) as created_at
    from public.payment_reminder_events history
    where history.property_id = ctx.property_id and history.period_start = ctx.current_period
      and history.member_id = person.id and history.reminder_scope = channel.scope
    order by history.created_at desc limit 1
  ) event on true
  order by channel.scope, person.full_name, person.id;
$$;

revoke all on function public.get_payment_reminder_recipient_audit(uuid) from public, anon;
grant execute on function public.get_payment_reminder_recipient_audit(uuid) to authenticated;

