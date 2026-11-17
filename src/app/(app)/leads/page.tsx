import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import { LEADS_PAGE_SIZE, parseLeadsQuery } from "@/lib/leads-list";
import LeadsClient from "@/components/leads/LeadsClient";
import type { Lead } from "@/lib/types";

// Only what the list shows (plus custom_fields for the ad-form name) — not every column.
const LIST_COLUMNS =
  "id,tenant_id,first_name,last_name,company,website,industry,email,phone,source,status,score,owner_id,converted_deal_id,created_at,custom_fields";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;
  const q = parseLeadsQuery(await searchParams, ctx.isRep);

  let query = supabase
    .from("leads")
    .select(LIST_COLUMNS, { count: "exact" })
    .is("deleted_at", null);
  if (q.view === "mine") query = query.eq("owner_id", ctx.userId);
  if (q.form) query = query.eq("custom_fields->>fb_form_name", q.form);
  if (q.ad) {
    // Quoted so an ad name containing commas/parentheses can't alter the filter.
    const v = `"${q.ad.replace(/[\\"]/g, "\\$&")}"`;
    query = query.or(`custom_fields->>fb_ad_name.eq.${v},custom_fields->>fb_ad_id.eq.${v}`);
  }
  if (q.q) {
    const like = `%${q.q}%`;
    query = query.or(
      ["first_name", "last_name", "company", "email", "phone"].map((c) => `${c}.ilike.${like}`).join(","),
    );
  }
  query =
    q.sort === "newest"
      ? query.order("created_at", { ascending: false })
      : query.order("score", { ascending: q.sort === "score_asc" }).order("created_at", { ascending: false });
  const from = (q.page - 1) * LEADS_PAGE_SIZE;
  query = query.range(from, from + LEADS_PAGE_SIZE - 1);

  const [{ data, count }, customFields, { data: forms }, { data: ads }] = await Promise.all([
    query,
    fetchCustomFieldDefs(supabase, "leads"),
    supabase.rpc("lead_form_names"),
    supabase.rpc("lead_ad_names"),
  ]);

  return (
    <LeadsClient
      initialLeads={(data ?? []) as Lead[]}
      total={count ?? 0}
      query={q}
      formNames={((forms ?? []) as { name: string }[]).map((f) => f.name)}
      adNames={((ads ?? []) as { name: string }[]).map((a) => a.name)}
      userId={ctx.userId}
      defaultMine={ctx.isRep}
      customFields={customFields}
    />
  );
}
