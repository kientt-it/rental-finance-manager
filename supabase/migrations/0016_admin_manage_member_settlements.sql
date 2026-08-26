-- Allow administrators to confirm settlement status for any household member.
-- Members keep self-service access only for their own settlement row.
-- Run after 0015_admin_hub_default_period_and_room_permissions.sql.

drop policy if exists "Members create own settlement" on public.household_member_settlements;
drop policy if exists "Members update own settlement" on public.household_member_settlements;
drop policy if exists "Members delete own settlement" on public.household_member_settlements;

create policy "Members create own settlement" on public.household_member_settlements
  for insert to authenticated
  with check (
    public.is_organization_admin(household_member_settlements.organization_id)
    or (
      public.is_organization_member(household_member_settlements.organization_id)
      and exists (
        select 1 from public.household_members profile
        where profile.id = household_member_settlements.member_id
          and profile.organization_id = household_member_settlements.organization_id
          and profile.auth_user_id = auth.uid()
          and profile.is_active
      )
    )
  );

create policy "Members update own settlement" on public.household_member_settlements
  for update to authenticated
  using (
    public.is_organization_admin(household_member_settlements.organization_id)
    or exists (
      select 1 from public.household_members profile
      where profile.id = household_member_settlements.member_id
        and profile.organization_id = household_member_settlements.organization_id
        and profile.auth_user_id = auth.uid()
        and profile.is_active
    )
  )
  with check (
    public.is_organization_admin(household_member_settlements.organization_id)
    or exists (
      select 1 from public.household_members profile
      where profile.id = household_member_settlements.member_id
        and profile.organization_id = household_member_settlements.organization_id
        and profile.auth_user_id = auth.uid()
        and profile.is_active
    )
  );

create policy "Members delete own settlement" on public.household_member_settlements
  for delete to authenticated
  using (
    public.is_organization_admin(household_member_settlements.organization_id)
    or exists (
      select 1 from public.household_members profile
      where profile.id = household_member_settlements.member_id
        and profile.organization_id = household_member_settlements.organization_id
        and profile.auth_user_id = auth.uid()
        and profile.is_active
    )
  );
