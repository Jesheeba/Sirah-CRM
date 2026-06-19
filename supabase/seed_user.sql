-- GENERATE A SECOND USER LOGIN (Sales Rep) in the SAME org as the admin.
-- Run in Supabase Dashboard -> SQL Editor. Requires seed_login.sql to have run first.
-- Email:    salesrep@sirahditital.in
-- Password: salesrep123

delete from auth.users where email = 'salesrep@sirahditital.in';

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_tenant  uuid;
  v_role    uuid;
begin
  -- Put this user in the admin's org if found, else the first/only org.
  select coalesce(
    (select tenant_id from public.profiles where email = 'sirahcrm@sirahditital.in' limit 1),
    (select id from public.tenants order by created_at limit 1)
  ) into v_tenant;
  if v_tenant is null then
    raise exception 'No organization exists yet — create/log into one first';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated',
    'salesrep@sirahditital.in', crypt('salesrep123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id::text, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', 'salesrep@sirahditital.in', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.profiles(id, tenant_id, email, full_name)
    values (v_user_id, v_tenant, 'salesrep@sirahditital.in', 'Sales Rep');

  select id into v_role from public.roles
    where tenant_id = v_tenant and name = 'Sales Rep' limit 1;
  if v_role is not null then
    insert into public.user_roles(tenant_id, user_id, role_id) values (v_tenant, v_user_id, v_role);
  end if;

  raise notice 'Created Sales Rep % in tenant %', v_user_id, v_tenant;
end $$;
