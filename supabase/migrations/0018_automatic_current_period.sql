-- Automatically create the current Vietnam calendar month and make it the default period.
-- Also protect closed periods from new expense rows created outside the application RPC.
-- Run after 0017_payment_qr_information.sql.

create or replace function public.ensure_current_financial_period(target_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  current_period_start date := date_trunc('month', timezone('Asia/Ho_Chi_Minh', now()))::date;
  saved_id uuid;
  current_is_default boolean;
begin
  select property.organization_id
  into target_organization_id
  from public.properties property
  where property.id = target_property_id
  for update;

  if target_organization_id is null then
    raise exception 'Property not found';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Membership required';
  end if;

  insert into public.financial_periods (
    organization_id,
    property_id,
    period_start,
    created_by,
    is_default
  )
  values (
    target_organization_id,
    target_property_id,
    current_period_start,
    auth.uid(),
    false
  )
  on conflict (property_id, period_start) do update
    set period_start = excluded.period_start
  returning id, is_default into saved_id, current_is_default;

  if not current_is_default then
    update public.financial_periods
    set is_default = false, updated_at = now()
    where property_id = target_property_id
      and is_default;

    update public.financial_periods
    set is_default = true, updated_at = now()
    where id = saved_id;
  end if;

  return saved_id;
end;
$$;

create or replace function public.prevent_expense_in_closed_period()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_period_status text;
begin
  select period.status
  into selected_period_status
  from public.financial_periods period
  where period.id = new.financial_period_id;

  if selected_period_status is null then
    raise exception 'Financial period not found';
  end if;
  if selected_period_status <> 'open' then
    raise exception 'Financial period is closed';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_expense_insert_into_closed_period on public.expenses;
create trigger prevent_expense_insert_into_closed_period
  before insert on public.expenses
  for each row execute function public.prevent_expense_in_closed_period();

revoke execute on function public.ensure_current_financial_period(uuid) from public, anon;
grant execute on function public.ensure_current_financial_period(uuid) to authenticated;

