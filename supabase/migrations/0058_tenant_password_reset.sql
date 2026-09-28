-- 0058 Tenant admin password reset (platform console).
-- Run after 0001-0057. Idempotent.
--
-- The actual password change requires the service-role auth.admin API (no SQL
-- equivalent — same reasoning as user creation in admin_provision_tenant), so it
-- happens in the `resetTenantPassword` server action via createAdminClient().
-- These two RPCs cover what SQL *can* do around that:
--   1. Resolve the target admin's auth user id, scoped to platform admins AND to
--      that tenant's own Admin-role users — so the server action can't be misused
--      to reset an arbitrary account elsewhere just by passing any user id.
--   2. Record the audit entry afterward (never the password itself — see fn_platform_audit).

create or replace function public.admin_resolve_tenant_admin(p_tenant uuid, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  select pr.id into v_user
  from public.profiles pr
  join public.user_roles ur on ur.user_id = pr.id
  join public.roles r on r.id = ur.role_id
  where pr.tenant_id = p_tenant and r.name = 'Admin' and pr.email = p_email
  limit 1;
  if v_user is null then raise exception 'No admin with that email on this tenant'; end if;
  return v_user;
end; $$;

create or replace function public.admin_log_password_reset(p_tenant uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  perform public.fn_platform_audit('tenant.reset_password', 'tenant', p_tenant,
    jsonb_build_object('email', p_email));
end; $$;

grant execute on function public.admin_resolve_tenant_admin(uuid, text) to authenticated;
grant execute on function public.admin_log_password_reset(uuid, text) to authenticated;
