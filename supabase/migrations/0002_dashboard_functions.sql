-- Dashboard bootstrap, aggregate reads, and atomic payment recording.
-- Run after 0001_initial_schema.sql.

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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select organization_id into target_organization_id
  from public.members
  where user_id = current_user_id
  order by created_at
  limit 1;

  if target_organization_id is null then
    insert into public.organizations (name, owner_user_id)
    values ('Nhà trọ của tôi', current_user_id)
    returning id into target_organization_id;

    insert into public.members (organization_id, user_id, role)
    values (target_organization_id, current_user_id, 'owner');
  end if;

  select id into target_property_id
  from public.properties
  where organization_id = target_organization_id
  order by created_at
  limit 1;

  if target_property_id is null then
    insert into public.properties (organization_id, name)
    values (target_organization_id, 'Nhà trọ của tôi')
    returning id into target_property_id;
  end if;

  return target_organization_id;
end;
$$;

create or replace function public.get_dashboard_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_organization_id uuid;
  target_property_id uuid;
  target_property_name text;
  result jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select m.organization_id into target_organization_id
  from public.members m
  where m.user_id = current_user_id
  order by m.created_at
  limit 1;

  if target_organization_id is null then raise exception 'Organization not initialized'; end if;

  select p.id, p.name into target_property_id, target_property_name
  from public.properties p
  where p.organization_id = target_organization_id
  order by p.created_at
  limit 1;

  select jsonb_build_object(
    'organization_id', target_organization_id,
    'property_id', target_property_id,
    'property_name', coalesce(target_property_name, 'Nhà trọ của tôi'),
    'revenue', coalesce((
      select sum(pay.amount) from public.payments pay
      where pay.organization_id = target_organization_id
        and pay.paid_at >= date_trunc('month', current_date)
        and pay.paid_at < date_trunc('month', current_date) + interval '1 month'
    ), 0),
    'expenses', coalesce((
      select sum(e.amount) from public.expenses e
      where e.organization_id = target_organization_id
        and e.expense_date >= date_trunc('month', current_date)::date
        and e.expense_date < (date_trunc('month', current_date) + interval '1 month')::date
    ), 0),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'code', r.code,
        'tenant', active_contract.full_name,
        'rent', r.base_rent,
        'status', r.status,
        'invoice_id', current_invoice.id,
        'due', coalesce(current_invoice.total_amount - current_invoice.paid_amount, 0)
      ) order by r.code)
      from public.rooms r
      left join lateral (
        select t.full_name
        from public.contracts c
        join public.tenants t on t.id = c.tenant_id
        where c.room_id = r.id and c.is_active
        order by c.start_date desc
        limit 1
      ) active_contract on true
      left join lateral (
        select i.id, i.total_amount, i.paid_amount
        from public.invoices i
        join public.contracts c on c.id = i.contract_id
        where c.room_id = r.id
          and i.status in ('issued', 'partial', 'overdue')
          and i.paid_amount < i.total_amount
        order by i.billing_period desc
        limit 1
      ) current_invoice on true
      where r.property_id = target_property_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.record_invoice_payment(
  target_invoice_id uuid,
  payment_amount numeric,
  payment_method_value public.payment_method default 'bank_transfer'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invoice public.invoices%rowtype;
  new_paid_amount numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if payment_amount <= 0 then raise exception 'Payment amount must be positive'; end if;

  select * into target_invoice from public.invoices where id = target_invoice_id for update;
  if not found or not public.is_organization_member(target_invoice.organization_id) then
    raise exception 'Invoice not found';
  end if;

  new_paid_amount := target_invoice.paid_amount + payment_amount;
  if new_paid_amount > target_invoice.total_amount then raise exception 'Payment exceeds outstanding balance'; end if;

  insert into public.payments (organization_id, invoice_id, amount, method)
  values (target_invoice.organization_id, target_invoice.id, payment_amount, payment_method_value);

  update public.invoices
  set paid_amount = new_paid_amount,
      status = case when new_paid_amount = total_amount then 'paid'::public.invoice_status else 'partial'::public.invoice_status end
  where id = target_invoice.id;

  return jsonb_build_object('invoice_id', target_invoice.id, 'paid_amount', new_paid_amount);
end;
$$;

revoke execute on function public.bootstrap_current_user() from public, anon;
revoke execute on function public.get_dashboard_data() from public, anon;
revoke execute on function public.record_invoice_payment(uuid, numeric, public.payment_method) from public, anon;

grant execute on function public.bootstrap_current_user() to authenticated;
grant execute on function public.get_dashboard_data() to authenticated;
grant execute on function public.record_invoice_payment(uuid, numeric, public.payment_method) to authenticated;
