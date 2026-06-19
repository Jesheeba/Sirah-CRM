-- 0020 Lead company fields + richer conversion.
-- Adds website/industry to leads, and makes convert_lead() carry the lead's
-- phone, website and industry into the new Account (previously only the name
-- was copied, so converted accounts had empty Industry/Phone/Website).
-- Supersedes the convert_lead in 0019 (keeps the pipeline_id ambiguity fix).
-- Additive + idempotent. Run after 0001-0019.

alter table public.leads add column if not exists website  text;
alter table public.leads add column if not exists industry text;

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

  -- Account carries the lead's company details.
  if v_account is null then
    insert into public.accounts(tenant_id, name, phone, website, industry, owner_id, created_by)
      values (v_tenant, coalesce(nullif(v_lead.company,''),
              trim(coalesce(v_lead.first_name,'') || ' ' || coalesce(v_lead.last_name,'')), 'Untitled Account'),
              v_lead.phone, v_lead.website, v_lead.industry,
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

  -- alias-qualified so `pipeline_id` resolves to the column, not the parameter.
  select s.id into v_stage
    from public.stages s
    where s.tenant_id = v_tenant and s.pipeline_id = v_pipeline
    order by s.display_order limit 1;

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

grant execute on function public.convert_lead(uuid, uuid, uuid, text, uuid) to authenticated;
