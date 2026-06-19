-- DEV LOGIN SEED — run in Supabase Dashboard -> SQL Editor.
-- Creates an auth user (email + password) directly, plus a ready org so you land on the dashboard.
-- Email:    sirahcrm@sirahditital.in
-- Password: sirah
-- NOTE: dev convenience only. Do not use a 5-char password in production.

-- Re-runnable: remove any prior copy of this user first (cascades to profile/identity).
delete from auth.users where email = 'sirahcrm@sirahditital.in';

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_tenant  uuid;
  v_admin   uuid;
  v_manager uuid;
  v_rep     uuid;
  v_pipeline uuid;
begin
  -- 1) Supabase Auth user (email pre-confirmed, bcrypt password) -----------
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated',
    'sirahcrm@sirahditital.in',
    crypt('sirah', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id::text, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', 'sirahcrm@sirahditital.in', 'email_verified', true),
    'email', now(), now(), now()
  );

  -- 2) Ready-to-use org: tenant + profile + roles + default pipeline -------
  insert into public.tenants(name, slug)
    values ('Sirah CRM', 'sirah-crm-' || substr(md5(random()::text), 1, 6))
    returning id into v_tenant;

  insert into public.profiles(id, tenant_id, email, full_name)
    values (v_user_id, v_tenant, 'sirahcrm@sirahditital.in', 'Sirah Admin');

  insert into public.roles(tenant_id, name, description, is_system)
    values (v_tenant, 'Admin', 'Full access', true) returning id into v_admin;
  insert into public.roles(tenant_id, name, description, is_system)
    values (v_tenant, 'Manager', 'Manages the team', true) returning id into v_manager;
  insert into public.roles(tenant_id, name, description, is_system)
    values (v_tenant, 'Sales Rep', 'Works own records', true) returning id into v_rep;

  insert into public.user_roles(tenant_id, user_id, role_id) values (v_tenant, v_user_id, v_admin);
  insert into public.role_permissions(tenant_id, role_id, permission_id)
    select v_tenant, v_admin, p.id from public.permissions p;

  insert into public.pipelines(tenant_id, name, is_default, display_order)
    values (v_tenant, 'Sales Pipeline', true, 0) returning id into v_pipeline;
  insert into public.stages(tenant_id, pipeline_id, name, display_order, probability, is_won, is_lost) values
    (v_tenant, v_pipeline, 'New',         0, 10,  false, false),
    (v_tenant, v_pipeline, 'Contacted',   1, 25,  false, false),
    (v_tenant, v_pipeline, 'Qualified',   2, 50,  false, false),
    (v_tenant, v_pipeline, 'Negotiation', 3, 75,  false, false),
    (v_tenant, v_pipeline, 'Won',         4, 100, true,  false),
    (v_tenant, v_pipeline, 'Lost',        5, 0,   false, true);

  raise notice 'Created login % with tenant %', v_user_id, v_tenant;
end $$;
