-- 0007 Role-based access: helpers, an admin-only role-change RPC, and tighter
-- write policies on user_roles. Run after 0001-0006.

-- is_admin(): does the caller hold the Admin role in their tenant? -----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.name = 'Admin'
  );
$$;

-- current_user_role(): highest role of the caller -----------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.name = 'Admin') then 'Admin'
    when exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.name = 'Manager') then 'Manager'
    else 'Sales Rep'
  end;
$$;

-- set_user_role(): admin-only; replaces a member's role -----------------------
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and tenant_id = v_tenant) then
    raise exception 'User is not in your organization';
  end if;
  select id into v_role_id from public.roles where tenant_id = v_tenant and name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;
  delete from public.user_roles where tenant_id = v_tenant and user_id = p_user_id;
  insert into public.user_roles(tenant_id, user_id, role_id) values (v_tenant, p_user_id, v_role_id);
end; $$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- Tighten user_roles: everyone in the tenant may READ; only admins may WRITE.
-- (The RPC above is SECURITY DEFINER, so it still works regardless.)
drop policy if exists tenant_isolation on public.user_roles;
create policy ur_read on public.user_roles
  for select using (tenant_id = public.current_tenant_id());
create policy ur_admin_write on public.user_roles
  for all
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());
