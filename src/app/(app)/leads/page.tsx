import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import LeadsClient from "@/components/leads/LeadsClient";
import type { Lead } from "@/lib/types";

export default async function LeadsPage() {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;

  const [{ data }, customFields] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    fetchCustomFieldDefs(supabase, "leads"),
  ]);

  return (
    <LeadsClient
      initialLeads={(data ?? []) as Lead[]}
      userId={ctx.userId}
      defaultMine={ctx.isRep}
      customFields={customFields}
    />
  );
}
