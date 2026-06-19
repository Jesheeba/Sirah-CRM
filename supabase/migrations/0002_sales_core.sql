-- 0002 Sales core: accounts, contacts, pipelines, stages, deals, leads.
-- Order matters: leads references accounts/contacts/deals (converted_* FKs).

-- ---------------------------------------------------------------- accounts --
create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  website       text,
  industry      text,
  phone         text,
  billing_address jsonb,
  owner_id      uuid references public.profiles(id),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  version       integer not null default 1
);
create index on public.accounts (tenant_id);

-- ---------------------------------------------------------------- contacts --
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  account_id    uuid references public.accounts(id) on delete set null,
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  title         text,
  owner_id      uuid references public.profiles(id),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  version       integer not null default 1
);
create index on public.contacts (tenant_id);
create index on public.contacts (tenant_id, account_id);
create index on public.contacts (tenant_id, email);

-- --------------------------------------------------------------- pipelines --
create table public.pipelines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  is_default    boolean not null default false,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1
);
create index on public.pipelines (tenant_id);

create table public.stages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  pipeline_id   uuid not null references public.pipelines(id) on delete cascade,
  name          text not null,
  display_order integer not null default 0,
  probability   integer not null default 0,
  is_won        boolean not null default false,
  is_lost       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.stages (tenant_id, pipeline_id);

-- ------------------------------------------------------------------- deals --
create table public.deals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  account_id    uuid references public.accounts(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  pipeline_id   uuid not null references public.pipelines(id),
  stage_id      uuid not null references public.stages(id),
  amount        numeric(14,2) not null default 0,
  currency      text not null default 'INR',
  status        text not null default 'open',
  expected_close_date date,
  closed_at     timestamptz,
  owner_id      uuid references public.profiles(id),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  version       integer not null default 1
);
create index on public.deals (tenant_id);
create index on public.deals (tenant_id, pipeline_id, stage_id);
create index on public.deals (tenant_id, account_id);
create index on public.deals (tenant_id, contact_id);
create index on public.deals (tenant_id, owner_id);
create index on public.deals (tenant_id, status);

-- ------------------------------------------------------------------- leads --
create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  first_name    text,
  last_name     text,
  company       text,
  email         text,
  phone         text,
  source        text,
  status        text not null default 'new',
  score         integer not null default 0,
  owner_id      uuid references public.profiles(id),
  converted_contact_id uuid references public.contacts(id),
  converted_account_id uuid references public.accounts(id),
  converted_deal_id    uuid references public.deals(id),
  converted_at  timestamptz,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  version       integer not null default 1
);
create index on public.leads (tenant_id);
create index on public.leads (tenant_id, status);
create index on public.leads (tenant_id, owner_id);
create index on public.leads (tenant_id, email);

-- --------------------------------------------------------------------- RLS --
alter table public.accounts  enable row level security;
alter table public.contacts  enable row level security;
alter table public.pipelines enable row level security;
alter table public.stages    enable row level security;
alter table public.deals     enable row level security;
alter table public.leads     enable row level security;

create policy tenant_isolation on public.accounts
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.contacts
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.pipelines
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.stages
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.deals
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.leads
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());

create trigger set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
