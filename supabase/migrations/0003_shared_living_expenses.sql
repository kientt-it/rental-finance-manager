-- Shared living expenses modeled from SINH HOẠT CHUNG.xlsx.
-- Run after 0002_dashboard_functions.sql.

alter table public.tenants add column if not exists bank_account text;
alter table public.tenants add column if not exists bank_name text;

create table public.shared_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  period date not null check (date_trunc('month', period)::date = period),
  expense_date date not null default current_date,
  description text not null check (char_length(description) between 2 and 180),
  amount numeric(14, 0) not null check (amount <> 0),
  status text not null default 'completed' check (status in ('draft', 'pending', 'completed', 'cancelled')),
  payer_tenant_id uuid references public.tenants(id) on delete set null,
  allocation_mode text not null default 'equal' check (allocation_mode in ('equal', 'manual')),
  reference_code text,
  note text,
  created_at timestamptz not null default now()
);

create table public.shared_expense_participants (
  expense_id uuid not null references public.shared_expenses(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  allocated_amount numeric(14, 2) not null check (allocated_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (expense_id, tenant_id)
);

-- Monthly snapshot used for the "Chi phí từng người" reconciliation screen.
create table public.shared_expense_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period date not null check (date_trunc('month', period)::date = period),
  allocated_amount numeric(14, 2) not null default 0 check (allocated_amount >= 0),
  advanced_amount numeric(14, 2) not null default 0 check (advanced_amount >= 0),
  is_settled boolean not null default false,
  settled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (property_id, tenant_id, period),
  check ((is_settled and settled_at is not null) or not is_settled)
);

alter table public.shared_expenses enable row level security;
alter table public.shared_expense_participants enable row level security;
alter table public.shared_expense_settlements enable row level security;

create policy "Member access" on public.shared_expenses for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
create policy "Member access" on public.shared_expense_participants for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
create policy "Member access" on public.shared_expense_settlements for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

create index shared_expenses_property_period_idx on public.shared_expenses (property_id, period desc);
create index shared_expense_participants_tenant_idx on public.shared_expense_participants (tenant_id);
create index shared_expense_settlements_period_idx on public.shared_expense_settlements (property_id, period desc);
