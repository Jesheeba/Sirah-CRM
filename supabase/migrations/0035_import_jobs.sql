-- 0035 Data Import — import_jobs queue + error log

create table if not exists public.import_jobs (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  entity      text        not null check (entity in ('leads','contacts','deals')),
  status      text        not null default 'pending'
                            check (status in ('pending','running','done','failed')),
  filename    text,
  total       int         not null default 0,
  inserted    int         not null default 0,
  updated     int         not null default 0,
  skipped     int         not null default 0,
  failed      int         not null default 0,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.import_errors (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  job_id     uuid not null references public.import_jobs(id) on delete cascade,
  row_index  int  not null,
  row_data   jsonb,
  error      text not null,
  created_at timestamptz not null default now()
);

create index if not exists import_jobs_tenant_idx   on public.import_jobs   (tenant_id, created_at desc);
create index if not exists import_errors_job_idx    on public.import_errors  (job_id);

alter table public.import_jobs   enable row level security;
alter table public.import_errors enable row level security;

drop policy if exists import_jobs_tenant   on public.import_jobs;
drop policy if exists import_errors_tenant on public.import_errors;

create policy import_jobs_tenant on public.import_jobs
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy import_errors_tenant on public.import_errors
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists stamp_tenant on public.import_jobs;
create trigger stamp_tenant before insert on public.import_jobs
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists stamp_tenant on public.import_errors;
create trigger stamp_tenant before insert on public.import_errors
  for each row execute function public.fn_stamp_tenant();
