-- Meta Data Deletion Requests
-- Required by Meta App Review: stores deletion confirmation codes so the
-- public /data-deletion-status?id= page can confirm a request was received.
-- Accessed only via service-role (no RLS needed — no tenant_id).

create table if not exists meta_deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  facebook_uid text not null,
  code         text not null unique,
  status       text not null default 'completed'
                 check (status in ('pending', 'completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists meta_deletion_requests_code_idx
  on meta_deletion_requests (code);
