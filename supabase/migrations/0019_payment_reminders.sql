-- Daily payment reminders for unpaid member balances (rent and shared living costs).
-- Run after 0018_automatic_current_period.sql.

create table if not exists public.payment_reminder_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  email_enabled boolean not null default false,
  in_app_enabled boolean not null default true,
  settlement_due_day smallint not null default 5 check (settlement_due_day between 1 and 31),
  reminder_before_days smallint not null default 3 check (reminder_before_days between 1 and 30),
  reminder_on_due_date boolean not null default true,
  reminder_after_days smallint not null default 3 check (reminder_after_days between 1 and 30),
  sender_name text not null default '',
  sender_email text not null default '',
  reply_to text not null default '',
  email_subject_template text not null default 'Nhắc thanh toán {{items}} trước hạn {{due_date}}',
  email_body_template text not null default E'Chào {{name}},\n\nBạn còn khoản {{items}} của kỳ {{period}}, tổng cộng {{amount}}. Hạn thanh toán là {{due_date}}.\n\nVui lòng mở ứng dụng để xem chi tiết và xác nhận thanh toán.\n\n708 La Thành',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.payment_reminder_settings enable row level security;
drop policy if exists "Admins manage payment reminder settings" on public.payment_reminder_settings;
create policy "Admins manage payment reminder settings" on public.payment_reminder_settings
  for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create table if not exists public.payment_reminder_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  period_start date not null,
  due_date date not null,
  member_id uuid not null references public.household_members(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  member_name text not null,
  recipient_email text not null,
  amount numeric(14, 0) not null check (amount > 0),
  items text not null,
  reminder_type text not null check (reminder_type in ('before', 'due', 'overdue')),
  in_app_enabled boolean not null default true,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_error text,
  attempt_count smallint not null default 0,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (property_id, member_id, period_start, due_date, reminder_type)
);

alter table public.payment_reminder_events enable row level security;
drop policy if exists "Members read own payment reminders" on public.payment_reminder_events;
create policy "Members read own payment reminders" on public.payment_reminder_events
  for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists "Admins read payment reminders" on public.payment_reminder_events;
create policy "Admins read payment reminders" on public.payment_reminder_events
  for select to authenticated using (public.is_organization_admin(organization_id));

create index if not exists payment_reminder_events_member_recent_idx
  on public.payment_reminder_events (auth_user_id, created_at desc);
create index if not exists payment_reminder_events_pending_email_idx
  on public.payment_reminder_events (email_status, created_at)
  where email_status in ('pending', 'failed');

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
           string_agg(distinct nullif(trim(expense.category), ''), ', ' order by nullif(trim(expense.category), '')) as items
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
  candidates as (
    select active.organization_id, active.property_id, active.period_start,
           (active.period_start + (active.due_day - 1))::date as due_date,
           member.id as member_id, member.auth_user_id,
           member.full_name as member_name,
           coalesce(nullif(trim(profile.contact_email), ''), account.email, '') as recipient_email,
           greatest(coalesce(allocation.allocated_amount, 0) - coalesce(payment.advanced_amount, 0), 0)::numeric as amount,
           coalesce(nullif(allocation.items, ''), 'Chi phí kỳ') as items,
           case
             when active.reminder_before_days = ((active.period_start + (active.due_day - 1))::date - today_vn) then 'before'
             when active.reminder_on_due_date and today_vn = (active.period_start + (active.due_day - 1))::date then 'due'
             when active.reminder_after_days = (today_vn - (active.period_start + (active.due_day - 1))::date) then 'overdue'
           end as reminder_type,
           active.in_app_enabled, active.email_enabled,
           coalesce(settlement.is_settled, false) as is_settled
    from active_periods active
    join public.household_members member
      on member.organization_id = active.organization_id and member.is_active and member.auth_user_id is not null
    left join public.user_profiles profile on profile.user_id = member.auth_user_id
    left join auth.users account on account.id = member.auth_user_id
    left join public.household_member_settlements settlement
      on settlement.property_id = active.property_id
     and settlement.member_id = member.id
     and settlement.period = active.period_start
    left join allocated allocation
      on allocation.financial_period_id = active.period_id
     and allocation.member_id = member.id
    left join advanced payment
      on payment.financial_period_id = active.period_id
     and payment.member_id = member.id
  )
  select candidate.organization_id, candidate.property_id, candidate.period_start,
         candidate.due_date, candidate.member_id, candidate.auth_user_id,
         candidate.member_name, candidate.recipient_email,
         candidate.amount, candidate.items, candidate.reminder_type,
         candidate.in_app_enabled, candidate.email_enabled
  from candidates candidate
  where candidate.reminder_type is not null
    and not candidate.is_settled
    and candidate.amount > 0
    and candidate.recipient_email <> ''
    and candidate.recipient_email not like '%@users.708.local';
end;
$$;

revoke all on function public.get_payment_reminder_candidates() from public, anon, authenticated;
grant execute on function public.get_payment_reminder_candidates() to service_role;

create or replace function public.mark_payment_reminder_read(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_reminder_events
  set read_at = coalesce(read_at, now())
  where id = target_event_id and auth_user_id = auth.uid();
  if not found then raise exception 'Notification not found'; end if;
end;
$$;

revoke all on function public.mark_payment_reminder_read(uuid) from public, anon;
grant execute on function public.mark_payment_reminder_read(uuid) to authenticated;

