-- Admin-only audit history for changes that affect the financial report.
-- Run after 0025_disable_overdue_reminders_with_zero.sql.

create table if not exists public.report_activity_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists report_activity_events_scope_idx
  on public.report_activity_events (organization_id, property_id, occurred_at desc, id desc);

alter table public.report_activity_events enable row level security;

revoke all on public.report_activity_events from anon, authenticated;
grant select on public.report_activity_events to authenticated;

drop policy if exists "Admins read report activity" on public.report_activity_events;
create policy "Admins read report activity" on public.report_activity_events
  for select to authenticated
  using (public.is_organization_admin(organization_id));

create or replace function public.record_report_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  target_property_id uuid;
  target_room_code text;
  target_member_name text;
  event_details jsonb;
begin
  old_data := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_data := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  if tg_op = 'UPDATE' and tg_table_name <> 'expenses'
     and (old_data - 'updated_at' - 'updated_by') = (new_data - 'updated_at' - 'updated_by') then
    return new;
  end if;

  row_data := case when tg_op = 'DELETE' then old_data else new_data end;
  target_property_id := nullif(row_data->>'property_id', '')::uuid;

  if tg_table_name = 'expenses' then
    event_details := jsonb_build_object(
      'category', row_data->>'category',
      'amount', row_data->>'amount',
      'previous_amount', old_data->>'amount',
      'expense_date', row_data->>'expense_date'
    );
  elsif tg_table_name = 'rooms' then
    event_details := jsonb_build_object(
      'room_code', row_data->>'code',
      'amount', row_data->>'base_rent',
      'previous_amount', old_data->>'base_rent'
    );
  elsif tg_table_name = 'household_member_settlements' then
    select member.full_name into target_member_name
    from public.household_members member where member.id = nullif(row_data->>'member_id', '')::uuid;
    event_details := jsonb_build_object(
      'member_id', row_data->>'member_id',
      'member_name', target_member_name,
      'is_settled', row_data->>'is_settled',
      'previous_is_settled', old_data->>'is_settled',
      'period', row_data->>'period'
    );
  elsif tg_table_name = 'room_rent_settlements' then
    select room.code into target_room_code
    from public.rooms room where room.id = nullif(row_data->>'room_id', '')::uuid;
    select member.full_name into target_member_name
    from public.household_members member where member.id = nullif(row_data->>'member_id', '')::uuid;
    event_details := jsonb_build_object(
      'member_id', row_data->>'member_id',
      'member_name', target_member_name,
      'room_code', target_room_code,
      'amount', row_data->>'share_amount',
      'is_settled', row_data->>'is_settled',
      'previous_is_settled', old_data->>'is_settled',
      'period', row_data->>'period'
    );
  elsif tg_table_name = 'room_member_assignments' then
    select room.property_id, room.code into target_property_id, target_room_code
    from public.rooms room where room.id = nullif(row_data->>'room_id', '')::uuid;
    select member.full_name into target_member_name
    from public.household_members member where member.id = nullif(row_data->>'member_id', '')::uuid;
    event_details := jsonb_build_object(
      'member_id', row_data->>'member_id',
      'member_name', target_member_name,
      'room_code', target_room_code
    );
  else
    event_details := jsonb_build_object('member_name', row_data->>'full_name');
  end if;

  insert into public.report_activity_events (
    organization_id, property_id, actor_user_id, entity_type, action, details
  ) values (
    (row_data->>'organization_id')::uuid,
    target_property_id,
    auth.uid(),
    tg_table_name,
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    jsonb_strip_nulls(event_details)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.record_report_activity() from public, anon, authenticated;

drop trigger if exists report_activity_expenses on public.expenses;
create trigger report_activity_expenses
  after insert or update or delete on public.expenses
  for each row execute function public.record_report_activity();

drop trigger if exists report_activity_rooms on public.rooms;
create trigger report_activity_rooms
  after insert or update or delete on public.rooms
  for each row execute function public.record_report_activity();

drop trigger if exists report_activity_room_assignments on public.room_member_assignments;
create trigger report_activity_room_assignments
  after insert or delete on public.room_member_assignments
  for each row execute function public.record_report_activity();

drop trigger if exists report_activity_living_settlements on public.household_member_settlements;
create trigger report_activity_living_settlements
  after insert or update or delete on public.household_member_settlements
  for each row execute function public.record_report_activity();

drop trigger if exists report_activity_rent_settlements on public.room_rent_settlements;
create trigger report_activity_rent_settlements
  after insert or update or delete on public.room_rent_settlements
  for each row execute function public.record_report_activity();

drop trigger if exists report_activity_members on public.household_members;
create trigger report_activity_members
  after insert or update or delete on public.household_members
  for each row execute function public.record_report_activity();
