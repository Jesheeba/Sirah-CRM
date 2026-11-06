-- Manual test fixture: Meta lead ad attribution display.
-- Run in the Supabase SQL Editor. Replace the tenant lookup if you have several tenants.
-- Clean up with the DELETE at the bottom when you're done.

-- Case A: ad name present (the happy path)
-- Case B: ad name withheld by Meta — must fall back to showing the ad ID
-- Case C: no ad at all (organic form) — must show "—" and make no claim
insert into public.leads (tenant_id, first_name, last_name, email, phone, source, status, custom_fields)
select t.id, v.first_name, v.last_name, v.email, v.phone, v.source, 'new', v.cf
from (select id from public.tenants where deleted_at is null order by created_at limit 1) t
cross join (values
  ('ZZTest-A', 'AdNamePresent', 'test-a@example.test', '+919000000001', 'Facebook Lead Ads',
   '{"course":"Graphic design",
     "fb_leadgen_id":"zz-test-a",
     "fb_form_id":"222","fb_form_name":"ZZTest form Nov",
     "fb_page_id":"333333333333333",
     "fb_ad_id":"444444444444444",
     "fb_ad_name":"ZZTest - Nov batch carousel A",
     "fb_platform":"fb",
     "fb_created_time":"2026-08-14T09:30:00+0000"}'::jsonb),
  ('ZZTest-B', 'AdNameMissing', 'test-b@example.test', '+919000000002', 'Instagram Lead Ads',
   '{"fb_leadgen_id":"zz-test-b",
     "fb_form_id":"222","fb_form_name":"ZZTest form Nov",
     "fb_page_id":"333333333333333",
     "fb_ad_id":"555555555555555",
     "fb_platform":"ig"}'::jsonb),
  ('ZZTest-C', 'NoAdAtAll', 'test-c@example.test', '+919000000003', 'Facebook Lead Ads',
   '{"fb_leadgen_id":"zz-test-c",
     "fb_form_id":"222","fb_form_name":"ZZTest form Nov",
     "fb_page_id":"333333333333333"}'::jsonb)
) as v(first_name, last_name, email, phone, source, cf);

-- Verify what landed:
select first_name,
       custom_fields->>'fb_ad_name' as ad_name,
       custom_fields->>'fb_ad_id'   as ad_id,
       custom_fields->>'fb_page_id' as page_id
from public.leads where first_name like 'ZZTest-%' order by first_name;

-- Cleanup (hard delete — these are fixtures, not real leads):
-- delete from public.leads where first_name like 'ZZTest-%';
