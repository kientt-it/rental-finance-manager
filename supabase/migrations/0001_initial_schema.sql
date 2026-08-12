-- Run this migration in the Supabase SQL Editor before connecting the UI.
create extension if not exists "pgcrypto";

create type public.member_role as enum ('owner', 'manager', 'viewer');
create type public.room_status as enum ('vacant', 'occupied', 'leaving', 'maintenance');
create type public.invoice_status as enum ('draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled');
create type public.payment_method as enum ('cash', 'bank_transfer', 'other');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  code text not null,
  base_rent numeric(14, 0) not null default 0 check (base_rent >= 0),
  status public.room_status not null default 'vacant',
  created_at timestamptz not null default now(),
  unique (property_id, code)
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  phone text,
  identity_number text,
  created_at timestamptz not null default now()
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  start_date date not null,
  end_date date,
  deposit_amount numeric(14, 0) not null default 0 check (deposit_amount >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  period date not null check (date_trunc('month', period)::date = period),
  electricity_value integer not null default 0 check (electricity_value >= 0),
  water_value integer not null default 0 check (water_value >= 0),
  recorded_at timestamptz not null default now(),
  unique (room_id, period)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  billing_period date not null check (date_trunc('month', billing_period)::date = billing_period),
  due_date date,
  total_amount numeric(14, 0) not null default 0 check (total_amount >= 0),
  paid_amount numeric(14, 0) not null default 0 check (paid_amount >= 0),
  status public.invoice_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (contract_id, billing_period),
  check (paid_amount <= total_amount)
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  item_type text not null,
  description text not null,
  quantity numeric(14, 2) not null default 1 check (quantity >= 0),
  unit_price numeric(14, 0) not null default 0 check (unit_price >= 0),
  amount numeric(14, 0) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14, 0) not null check (amount > 0),
  method public.payment_method not null default 'cash',
  paid_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  category text not null,
  amount numeric(14, 0) not null check (amount > 0),
  expense_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

-- All users can access only the organization(s) in which they are a member.
create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where organization_id = target_organization_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_organization_owner(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where organization_id = target_organization_id and user_id = auth.uid() and role = 'owner'
  );
$$;

grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_owner(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.properties enable row level security;
alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.contracts enable row level security;
alter table public.meter_readings enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;

create policy "Members can read their organizations" on public.organizations for select to authenticated using (public.is_organization_member(id));
create policy "Members can read organization memberships" on public.members for select to authenticated using (public.is_organization_member(organization_id));
create policy "Owners can manage memberships" on public.members for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));

-- The same organization boundary applies to all tenant/business data.
create policy "Member access" on public.properties for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.rooms for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.tenants for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.contracts for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.meter_readings for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.invoices for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.invoice_items for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.payments for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "Member access" on public.expenses for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create index rooms_organization_id_idx on public.rooms (organization_id);
create index invoices_organization_status_idx on public.invoices (organization_id, status);
create index payments_invoice_id_idx on public.payments (invoice_id);
