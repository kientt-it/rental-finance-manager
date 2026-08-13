-- Administrators manage the house but do not participate in shared expenses.
-- Run after 0009_household_members.sql.

-- Remove any administrator accidentally included in existing allocations.
delete from public.expense_member_participants participant
using public.household_members profile, public.members access
where participant.member_id = profile.id
  and access.organization_id = profile.organization_id
  and access.user_id = profile.auth_user_id
  and access.role::text = 'admin';

-- Re-split existing expenses equally between the remaining participants.
with participant_counts as (
  select expense_id, count(*)::numeric as total
  from public.expense_member_participants
  group by expense_id
)
update public.expense_member_participants participant
set allocated_amount = expense.amount / participant_counts.total
from public.expenses expense, participant_counts
where participant.expense_id = expense.id
  and participant_counts.expense_id = expense.id
  and participant_counts.total > 0;

delete from public.household_member_settlements settlement
using public.household_members profile, public.members access
where settlement.member_id = profile.id
  and access.organization_id = profile.organization_id
  and access.user_id = profile.auth_user_id
  and access.role::text = 'admin';

create or replace function public.save_household_expense(
  target_expense_id uuid,
  target_property_id uuid,
  target_category text,
  target_amount numeric,
  target_expense_date date,
  target_payer_member_id uuid,
  target_participant_ids uuid[],
  target_status text default 'completed',
  target_reference_code text default null,
  target_note text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_organization_id uuid;
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
      organization_id, property_id, category, amount, expense_date, note,
      payer_member_id, status, reference_code
    )
    values (
      target_organization_id, target_property_id, trim(target_category), target_amount,
      target_expense_date, nullif(trim(target_note), ''), target_payer_member_id,
      target_status, nullif(trim(target_reference_code), '')
    ) returning id into saved_expense_id;
  else
    update public.expenses set
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
    insert into public.expense_member_participants (
      expense_id, organization_id, member_id, allocated_amount
    ) values (
      saved_expense_id, target_organization_id, participant_id,
      target_amount / participant_count
    );
  end loop;
  return saved_expense_id;
end;
$$;

revoke execute on function public.save_household_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.save_household_expense(uuid, uuid, text, numeric, date, uuid, uuid[], text, text, text) to authenticated;
