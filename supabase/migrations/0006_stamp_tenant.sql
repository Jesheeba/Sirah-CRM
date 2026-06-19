-- 0006 Auto-stamp tenant_id on insert so clients never send (or spoof) it.
-- RLS WITH CHECK still enforces tenant_id = current_tenant_id().

create or replace function public.fn_stamp_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;
  return new;
end; $$;

create trigger stamp_tenant before insert on public.leads
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.contacts
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.accounts
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.deals
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.tasks
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.notes
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.activities
  for each row execute function public.fn_stamp_tenant();
create trigger stamp_tenant before insert on public.custom_field_definitions
  for each row execute function public.fn_stamp_tenant();
