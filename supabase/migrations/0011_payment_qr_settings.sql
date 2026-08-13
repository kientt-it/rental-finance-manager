-- Store one shared payment QR image for each property.
-- Run after 0010_exclude_admin_from_expenses.sql.

create table if not exists public.payment_qr_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  qr_image_data text not null,
  file_name text,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint payment_qr_image_size check (octet_length(qr_image_data) <= 2200000),
  constraint payment_qr_property_organization_unique unique (property_id, organization_id)
);

alter table public.payment_qr_settings enable row level security;

drop policy if exists "Members read payment QR" on public.payment_qr_settings;
create policy "Members read payment QR"
  on public.payment_qr_settings for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "Admins insert payment QR" on public.payment_qr_settings;
create policy "Admins insert payment QR"
  on public.payment_qr_settings for insert to authenticated
  with check (
    public.is_organization_admin(organization_id)
    and exists (
      select 1 from public.properties property
      where property.id = property_id
        and property.organization_id = organization_id
    )
  );

drop policy if exists "Admins update payment QR" on public.payment_qr_settings;
create policy "Admins update payment QR"
  on public.payment_qr_settings for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (
    public.is_organization_admin(organization_id)
    and exists (
      select 1 from public.properties property
      where property.id = property_id
        and property.organization_id = organization_id
    )
  );

drop policy if exists "Admins delete payment QR" on public.payment_qr_settings;
create policy "Admins delete payment QR"
  on public.payment_qr_settings for delete to authenticated
  using (public.is_organization_admin(organization_id));

create index if not exists payment_qr_settings_organization_idx
  on public.payment_qr_settings (organization_id);
