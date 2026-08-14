-- Self-service settlement confirmation and configurable Report/Donate actions.
-- Run after 0013_financial_periods.sql.

drop policy if exists "Organization access" on public.household_member_settlements;
drop policy if exists "Members read settlements" on public.household_member_settlements;
drop policy if exists "Members create own settlement" on public.household_member_settlements;
drop policy if exists "Members update own settlement" on public.household_member_settlements;
drop policy if exists "Members delete own settlement" on public.household_member_settlements;

create policy "Members read settlements" on public.household_member_settlements
  for select to authenticated
  
  using (public.is_organization_member(organization_id));

create policy "Members create own settlement" on public.household_member_settlements
  for insert to authenticated
  with check (
    public.is_organization_member(household_member_settlements.organization_id)
    and exists (
      select 1 from public.household_members profile
      where profile.id = household_member_settlements.member_id
        and profile.organization_id = household_member_settlements.organization_id
        and profile.auth_user_id = auth.uid()
        and profile.is_active
    )
  );

create policy "Members update own settlement" on public.household_member_settlements
  for update to authenticated
  using (
    exists (
      select 1 from public.household_members profile
      where profile.id = household_member_settlements.member_id
        and profile.organization_id = household_member_settlements.organization_id
        and profile.auth_user_id = auth.uid()
        and profile.is_active
    )
  )
  with check (
    exists (
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
    exists (
      select 1 from public.household_members profile
      where profile.id = household_member_settlements.member_id
        and profile.organization_id = household_member_settlements.organization_id
        and profile.auth_user_id = auth.uid()
        and profile.is_active
    )
  );

create table if not exists public.support_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_contact_label text,
  report_contact_url text,
  donate_message text,
  donate_qr_image_data text,
  donate_qr_file_name text,
  donate_account_name text,
  donate_bank_account text,
  donate_bank_name text,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  check (report_contact_url is null or report_contact_url ~ '^https?://'),
  check (char_length(coalesce(report_contact_label, '')) <= 120),
  check (char_length(coalesce(donate_account_name, '')) <= 160),
  check (char_length(coalesce(donate_bank_account, '')) <= 80),
  check (char_length(coalesce(donate_bank_name, '')) <= 120)
);

alter table public.support_settings enable row level security;

drop policy if exists "Members read support settings" on public.support_settings;
create policy "Members read support settings" on public.support_settings
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage support settings" on public.support_settings;
create policy "Admins manage support settings" on public.support_settings
  for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
