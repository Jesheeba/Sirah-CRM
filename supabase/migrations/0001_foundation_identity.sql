-- 0001 Foundation & Identity: tenancy, profiles (Supabase Auth), RBAC, invitations.
-- Apply in order. Safe to run on a fresh Supabase project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- helpers --
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- NOTE: current_tenant_id() is defined AFTER the profiles table below, because a
-- language-sql function body is validated at creation time and references profiles.

-- ----------------------------------------------------------------- tenants --
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  plan_tier   text not null default 'free',
  currency    text not null default 'INR',
  timezone    text not null default 'Asia/Kolkata',
  locale      text not null default 'en',
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------- profiles --
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.profiles (tenant_id);

-- Returns the caller's tenant. Defined here (after profiles) so the language-sql
-- body validates. security definer lets it read profiles without recursing into RLS.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------------------- roles --
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create index on public.roles (tenant_id);

-- ------------------------------------------------------------- permissions --
create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  description text
);

create table public.role_permissions (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
create index on public.role_permissions (tenant_id);

create table public.user_roles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role_id   uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);
create index on public.user_roles (tenant_id);

-- ------------------------------------------------------------- invitations --
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  role_id     uuid not null references public.roles(id),
  token       text not null unique,
  status      text not null default 'pending',
  invited_by  uuid references public.profiles(id),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now()
);
create index on public.invitations (tenant_id, status);

-- --------------------------------------------------------------------- RLS --
alter table public.tenants          enable row level security;
alter table public.profiles         enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.invitations      enable row level security;

create policy tenant_self on public.tenants
  for all using (id = public.current_tenant_id())
          with check (id = public.current_tenant_id());
create policy tenant_isolation on public.profiles
  for all using (tenant_id = public.current_tenant_id())
          with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.roles
  for all using (tenant_id = public.current_tenant_id())
          with check (tenant_id = public.current_tenant_id());
create policy permissions_read on public.permissions
  for select using (auth.role() = 'authenticated');
create policy tenant_isolation on public.role_permissions
  for all using (tenant_id = public.current_tenant_id())
          with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.user_roles
  for all using (tenant_id = public.current_tenant_id())
          with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.invitations
  for all using (tenant_id = public.current_tenant_id())
          with check (tenant_id = public.current_tenant_id());

create trigger set_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();
