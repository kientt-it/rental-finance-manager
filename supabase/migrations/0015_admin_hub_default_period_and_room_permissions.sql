-- Centralized admin management, shared default period and read-only room access for members.
-- Run after 0014_self_settlement_and_support_settings.sql.

alter table public.financial_periods
  add column if not exists is_default boolean not null default false;

create unique index if not exists financial_periods_one_default_per_property_idx
  on public.financial_periods (property_id)
  where is_default;

-- Prefer the current calendar month for existing properties; otherwise use the newest period.
with ranked_periods as (
  select period.id,
         row_number() over (
           partition by period.property_id
           order by (period.period_start = date_trunc('month', current_date)::date) desc,
                    period.period_start desc
         ) as position
  from public.financial_periods period
  where not exists (
    select 1 from public.financial_periods selected
    where selected.property_id = period.property_id and selected.is_default
  )
)
update public.financial_periods period
set is_default = true, updated_at = now()
from ranked_periods ranked
where period.id = ranked.id and ranked.position = 1;

drop function if exists public.get_financial_periods(uuid);
create function public.get_financial_periods(target_property_id uuid)
returns table (
  id uuid,
  period_start date,
  status text,
  is_default boolean,
  exported_at timestamptz,
  expense_count bigint,
  total_amount numeric
)
language sql stable security definer set search_path = public
as $$
  select period.id, period.period_start, period.status, period.is_default, period.exported_at,
         count(expense.id), coalesce(sum(expense.amount), 0)
  from public.financial_periods period
  left join public.expenses expense on expense.financial_period_id = period.id
  where period.property_id = target_property_id
    and public.is_organization_member(period.organization_id)
  group by period.id
  order by period.period_start desc;
$$;

create or replace function public.set_default_financial_period(target_period_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_organization_id uuid;
  target_property_id uuid;
begin
  select organization_id, property_id
  into target_organization_id, target_property_id
  from public.financial_periods
  where id = target_period_id;

  if target_organization_id is null then raise exception 'Financial period not found'; end if;
  if not public.is_organization_admin(target_organization_id) then raise exception 'Administrator permission required'; end if;

  update public.financial_periods
  set is_default = false, updated_at = now()
  where property_id = target_property_id and is_default;

  update public.financial_periods
  set is_default = true, updated_at = now()
  where id = target_period_id;
end;
$$;

create or replace function public.create_financial_period(target_property_id uuid, target_period_start date)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_organization_id uuid;
  normalized_start date := date_trunc('month', target_period_start)::date;
  saved_id uuid;
  should_be_default boolean;
begin
  select property.organization_id into target_organization_id
  from public.properties property where property.id = target_property_id;
  if target_organization_id is null then raise exception 'Property not found'; end if;
  if not public.is_organization_admin(target_organization_id) then raise exception 'Administrator permission required'; end if;

  select not exists (
    select 1 from public.financial_periods period
    where period.property_id = target_property_id and period.is_default
  ) into should_be_default;

  insert into public.financial_periods (organization_id, property_id, period_start, created_by, is_default)
  values (target_organization_id, target_property_id, normalized_start, auth.uid(), should_be_default)
  on conflict (property_id, period_start) do update set updated_at = now()
  returning id into saved_id;
  return saved_id;
end;
$$;

revoke execute on function public.get_financial_periods(uuid) from public, anon;
revoke execute on function public.set_default_financial_period(uuid) from public, anon;
revoke execute on function public.create_financial_period(uuid, date) from public, anon;
grant execute on function public.get_financial_periods(uuid) to authenticated;
grant execute on function public.set_default_financial_period(uuid) to authenticated;
grant execute on function public.create_financial_period(uuid, date) to authenticated;

-- Everyone in the organization can view rooms; only admins can change them.
drop policy if exists "Member access" on public.rooms;
drop policy if exists "Members read rooms" on public.rooms;
drop policy if exists "Admins insert rooms" on public.rooms;
drop policy if exists "Admins update rooms" on public.rooms;
drop policy if exists "Admins delete rooms" on public.rooms;

create policy "Members read rooms" on public.rooms for select to authenticated
  using (public.is_organization_member(organization_id));
create policy "Admins insert rooms" on public.rooms for insert to authenticated
  with check (public.is_organization_admin(organization_id));
create policy "Admins update rooms" on public.rooms for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
create policy "Admins delete rooms" on public.rooms for delete to authenticated
  using (public.is_organization_admin(organization_id));

-- Room assignments are part of room management and follow the same permission split.
drop policy if exists "Organization access" on public.room_member_assignments;
drop policy if exists "Members read room assignments" on public.room_member_assignments;
drop policy if exists "Admins insert room assignments" on public.room_member_assignments;
drop policy if exists "Admins update room assignments" on public.room_member_assignments;
drop policy if exists "Admins delete room assignments" on public.room_member_assignments;

create policy "Members read room assignments" on public.room_member_assignments for select to authenticated
  using (public.is_organization_member(organization_id));
create policy "Admins insert room assignments" on public.room_member_assignments for insert to authenticated
  with check (public.is_organization_admin(organization_id));
create policy "Admins update room assignments" on public.room_member_assignments for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
create policy "Admins delete room assignments" on public.room_member_assignments for delete to authenticated
  using (public.is_organization_admin(organization_id));
