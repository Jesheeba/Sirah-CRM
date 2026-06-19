-- 0004 RPCs: transactional operations PostgREST can't express.
-- All are SECURITY DEFINER (bypass RLS) and validate tenant ownership manually.

-- ------------------------------------------------- signup_organization() --
create or replace function public.signup_organization(
  org_name text,
  currency text default 'INR',
  timezone text default 'Asia/Kolkata',
  locale   text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_admin_role uuid;
  v_manager_role uuid;
  v_rep_role uuid;
  v_pipeline uuid;
  v_existing uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Idempotent: if this user already has a profile, return its tenant.
  select tenant_id into v_existing from public.profiles where id = v_uid;
  if v_existing is not null then
    return jsonb_build_object('tenant_id', v_existing, 'profile_id', v_uid, 'existing', true);
  end if;

  v_slug := lower(regexp_replace(coalesce(org_name,'org'), '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);

  insert into public.tenants(name, slug, currency, timezone, locale)
    values (org_name, v_slug, currency, timezone, locale)
    returning id into v_tenant;

  insert into public.profiles(id, tenant_id, email)
    values (v_uid, v_tenant, (select email from auth.users where id = v_uid));

  insert into public.roles(tenant_id, name, description, is_system) values
    (v_tenant, 'Admin', 'Full access', true) returning id into v_admin_role;
  insert into public.roles(tenant_id, name, description, is_system) values
    (v_tenant, 'Manager', 'Manages the team and all records', true) returning id into v_manager_role;
  insert into public.roles(tenant_id, name, description, is_system) values
    (v_tenant, 'Sales Rep', 'Works own leads and deals', true) returning id into v_rep_role;

  -- Assign Admin role to the creator, grant Admin every permission.
  insert into public.user_roles(tenant_id, user_id, role_id) values (v_tenant, v_uid, v_admin_role);
  insert into public.role_permissions(tenant_id, role_id, permission_id)
    select v_tenant, v_admin_role, p.id from public.permissions p;

  -- Default pipeline + stages.
  insert into public.pipelines(tenant_id, name, is_default, display_order)
    values (v_tenant, 'Sales Pipeline', true, 0) returning id into v_pipeline;
  insert into public.stages(tenant_id, pipeline_id, name, display_order, probability, is_won, is_lost) values
    (v_tenant, v_pipeline, 'New',         0, 10, false, false),
    (v_tenant, v_pipeline, 'Contacted',   1, 25, false, false),
    (v_tenant, v_pipeline, 'Qualified',   2, 50, false, false),
    (v_tenant, v_pipeline, 'Negotiation', 3, 75, false, false),
    (v_tenant, v_pipeline, 'Won',         4, 100, true,  false),
    (v_tenant, v_pipeline, 'Lost',        5, 0,   false, true);

  return jsonb_build_object('tenant_id', v_tenant, 'profile_id', v_uid, 'existing', false);
end; $$;

-- --------------------------------------------------------- convert_lead() --
create or replace function public.convert_lead(
  lead_id     uuid,
  account_id  uuid default null,
  contact_id  uuid default null,
  deal_name   text default null,
  pipeline_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_lead public.leads%rowtype;
  v_account uuid := account_id;
  v_contact uuid := contact_id;
  v_pipeline uuid := pipeline_id;
  v_stage uuid;
  v_deal uuid;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;

  select * into v_lead from public.leads where id = lead_id and tenant_id = v_tenant;
  if not found then raise exception 'Lead not found'; end if;
  if v_lead.converted_deal_id is not null then
    return jsonb_build_object('deal_id', v_lead.converted_deal_id,
      'account_id', v_lead.converted_account_id, 'contact_id', v_lead.converted_contact_id,
      'already_converted', true);
  end if;
  if v_lead.status <> 'qualified' then
    raise exception 'Lead must be Qualified before conversion (current: %)', v_lead.status;
  end if;

  if v_account is null then
    insert into public.accounts(tenant_id, name, owner_id, created_by)
      values (v_tenant, coalesce(nullif(v_lead.company,''),
              trim(coalesce(v_lead.first_name,'') || ' ' || coalesce(v_lead.last_name,'')), 'Untitled Account'),
              v_lead.owner_id, auth.uid())
      returning id into v_account;
  end if;

  if v_contact is null then
    insert into public.contacts(tenant_id, account_id, first_name, last_name, email, phone, owner_id, created_by)
      values (v_tenant, v_account, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone,
              v_lead.owner_id, auth.uid())
      returning id into v_contact;
  end if;

  if v_pipeline is null then
    select id into v_pipeline from public.pipelines
      where tenant_id = v_tenant and is_default = true and deleted_at is null limit 1;
  end if;
  select id into v_stage from public.stages
    where tenant_id = v_tenant and pipeline_id = v_pipeline order by display_order limit 1;

  insert into public.deals(tenant_id, name, account_id, contact_id, pipeline_id, stage_id, owner_id, created_by)
    values (v_tenant,
            coalesce(deal_name, (select name from public.accounts where id = v_account) || ' — Deal'),
            v_account, v_contact, v_pipeline, v_stage, v_lead.owner_id, auth.uid())
    returning id into v_deal;

  update public.leads
     set converted_account_id = v_account,
         converted_contact_id = v_contact,
         converted_deal_id = v_deal,
         converted_at = now(),
         status = 'converted'
   where id = lead_id;

  return jsonb_build_object('deal_id', v_deal, 'account_id', v_account, 'contact_id', v_contact,
    'already_converted', false);
end; $$;

-- ------------------------------------------------------ move_deal_stage() --
create or replace function public.move_deal_stage(deal_id uuid, to_stage_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_deal public.deals%rowtype;
  v_stage public.stages%rowtype;
  v_status text;
  v_closed timestamptz;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;
  select * into v_deal from public.deals where id = deal_id and tenant_id = v_tenant;
  if not found then raise exception 'Deal not found'; end if;
  select * into v_stage from public.stages where id = to_stage_id and tenant_id = v_tenant;
  if not found then raise exception 'Stage not found'; end if;
  if v_stage.pipeline_id <> v_deal.pipeline_id then
    raise exception 'Stage does not belong to the deal''s pipeline';
  end if;

  if v_stage.is_won then v_status := 'won'; v_closed := now();
  elsif v_stage.is_lost then v_status := 'lost'; v_closed := now();
  else v_status := 'open'; v_closed := null;
  end if;

  insert into public.deal_stage_history(tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
    values (v_tenant, deal_id, v_deal.stage_id, to_stage_id, auth.uid());

  update public.deals set stage_id = to_stage_id, status = v_status, closed_at = v_closed
    where id = deal_id;

  return (select to_jsonb(d) from public.deals d where d.id = deal_id);
end; $$;

-- Allow authenticated users to call the RPCs.
grant execute on function public.signup_organization(text, text, text, text) to authenticated;
grant execute on function public.convert_lead(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.move_deal_stage(uuid, uuid) to authenticated;
