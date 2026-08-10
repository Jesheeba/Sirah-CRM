-- 0050 Systematic Duplicate Detection + Merge
-- The only existing dedup was inside the CSV import wizard — manual lead creation had
-- zero duplicate checking (the master doc claimed otherwise; it was stale, corrected
-- alongside this migration). Adds: a duplicate-lookup RPC (used both for the real-time
-- create-time warning and the "Potential Duplicates" review page) and an atomic merge RPC.
-- Run after 0001-0049. Idempotent.

-- ───────────────────────── Lookup ─────────────────────────
-- Matches on exact (trimmed, lowercased) email or phone — same normalization the CSV
-- import wizard already uses, kept consistent rather than inventing fuzzy matching here.
create or replace function public.fn_find_duplicate_leads(
  p_email text default null,
  p_phone text default null,
  p_exclude_id uuid default null
) returns setof public.leads
language sql stable security invoker set search_path = public as $$
  select * from public.leads
   where tenant_id = public.current_tenant_id()
     and deleted_at is null
     and (id <> p_exclude_id or p_exclude_id is null)
     and (
       (p_email is not null and trim(p_email) <> '' and lower(trim(email)) = lower(trim(p_email)))
       or
       (p_phone is not null and trim(p_phone) <> '' and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g') and regexp_replace(p_phone, '[^0-9]', '', 'g') <> '')
     )
   order by created_at asc;
$$;
grant execute on function public.fn_find_duplicate_leads(text, text, uuid) to authenticated;

-- Whole-tenant scan for the review page: groups of 2+ leads sharing a normalized
-- email or phone. Returns one row per group with the member ids, so the client only
-- needs one round trip instead of an N+1 per lead.
create or replace function public.fn_scan_duplicate_lead_groups()
returns table (match_key text, match_type text, lead_ids uuid[])
language sql stable security invoker set search_path = public as $$
  select lower(trim(email)) as match_key, 'email' as match_type, array_agg(id order by created_at)
    from public.leads
   where tenant_id = public.current_tenant_id() and deleted_at is null
     and email is not null and trim(email) <> ''
   group by lower(trim(email))
  having count(*) > 1
  union all
  select regexp_replace(phone, '[^0-9]', '', 'g') as match_key, 'phone' as match_type, array_agg(id order by created_at)
    from public.leads
   where tenant_id = public.current_tenant_id() and deleted_at is null
     and phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') <> ''
   group by regexp_replace(phone, '[^0-9]', '', 'g')
  having count(*) > 1;
$$;
grant execute on function public.fn_scan_duplicate_lead_groups() to authenticated;

-- ───────────────────────── Merge ─────────────────────────
-- Reassigns every lead-linked record (notes/activities/tasks/communications/sequence
-- enrollments) from each duplicate onto the primary, then soft-deletes the duplicates —
-- never a hard delete, consistent with this app's delete convention everywhere else.
-- security invoker (not definer): runs as the calling admin, so RLS still gates it —
-- the app layer additionally requires Admin/Manager before calling this.
create or replace function public.fn_merge_leads(p_primary_id uuid, p_duplicate_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_primary public.leads%rowtype;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;
  if p_primary_id = any(p_duplicate_ids) then
    raise exception 'Primary lead cannot also be listed as a duplicate';
  end if;

  select * into v_primary from public.leads where id = p_primary_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'Primary lead not found'; end if;

  update public.notes set related_to_id = p_primary_id
   where related_to_type = 'lead' and related_to_id = any(p_duplicate_ids);
  update public.activities set related_to_id = p_primary_id
   where related_to_type = 'lead' and related_to_id = any(p_duplicate_ids);
  update public.tasks set related_to_id = p_primary_id
   where related_to_type = 'lead' and related_to_id = any(p_duplicate_ids);
  update public.communications set related_to_id = p_primary_id
   where related_to_type = 'lead' and related_to_id = any(p_duplicate_ids);
  -- sequence_enrollments has a unique-while-active index on (sequence_id, lead_id) — a
  -- duplicate lead actively enrolled in the same sequence as the primary would collide,
  -- so those are stopped instead of reassigned rather than failing the whole merge.
  update public.sequence_enrollments
     set status = 'stopped', stop_reason = 'merged into another lead'
   where lead_id = any(p_duplicate_ids) and status = 'active'
     and sequence_id in (
       select sequence_id from public.sequence_enrollments where lead_id = p_primary_id and status = 'active'
     );
  -- Reassign everything except the rows just neutralized above (identified precisely by
  -- that stop_reason marker, not by status='stopped' generally — a duplicate's genuinely
  -- pre-existing stopped/completed enrollments should still move to the primary's history).
  update public.sequence_enrollments set lead_id = p_primary_id
   where lead_id = any(p_duplicate_ids)
     and not (status = 'stopped' and stop_reason = 'merged into another lead');

  update public.leads
     set deleted_at = now()
   where id = any(p_duplicate_ids) and tenant_id = v_tenant;
end; $$;
grant execute on function public.fn_merge_leads(uuid, uuid[]) to authenticated;
