-- 0063 Leads list performance: distinct Meta ad-form names for the Leads filter dropdown.
-- Run after 0062. Idempotent.
--
-- SECURITY INVOKER on purpose: it runs as the caller, so RLS on `leads` still limits the
-- result to the caller's own tenant. The Leads page is now paginated, so it can no longer
-- derive this list from the rows it happens to have loaded.

create or replace function public.lead_form_names()
returns table (name text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct l.custom_fields->>'fb_form_name'
  from public.leads l
  where l.deleted_at is null
    and l.custom_fields->>'fb_form_name' is not null
  order by 1
$$;

grant execute on function public.lead_form_names() to authenticated;

-- Same for the Ad filter: the ad's name, or its id where Meta withheld the name.
create or replace function public.lead_ad_names()
returns table (name text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct coalesce(l.custom_fields->>'fb_ad_name', l.custom_fields->>'fb_ad_id')
  from public.leads l
  where l.deleted_at is null
    and coalesce(l.custom_fields->>'fb_ad_name', l.custom_fields->>'fb_ad_id') is not null
  order by 1
$$;

grant execute on function public.lead_ad_names() to authenticated;

-- The two filters/sorts the list uses on large tenants.
create index if not exists leads_tenant_created_idx on public.leads (tenant_id, created_at desc) where deleted_at is null;
create index if not exists leads_tenant_score_idx on public.leads (tenant_id, score desc) where deleted_at is null;
