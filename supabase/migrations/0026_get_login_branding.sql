-- 0026 Anonymous login branding lookup.
-- The login page is pre-auth, so current_tenant_id() is null and the ob_read RLS
-- policy on organization_branding can't be used. This SECURITY DEFINER function is
-- the ONLY anonymous read path: it resolves a tenant by slug and returns a fixed
-- set of safe, public branding fields — never module config, secrets, or the whole
-- row. Only active, non-deleted tenants resolve.

create or replace function public.get_login_branding(p_slug text)
returns table (
  brand_name           text,
  logo_url             text,
  favicon_url          text,
  login_background_url text,
  welcome_message      text,
  company_description  text,
  primary_color        text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.brand_name, b.logo_url, b.favicon_url, b.login_background_url,
         b.welcome_message, b.company_description, b.primary_color
  from public.organization_branding b
  join public.tenants t on t.id = b.tenant_id
  where t.slug = p_slug
    and t.deleted_at is null
    and t.status = 'active'
  limit 1;
$$;

grant execute on function public.get_login_branding(text) to anon, authenticated;
