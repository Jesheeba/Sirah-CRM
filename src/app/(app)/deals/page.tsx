import { createClient } from "@/lib/supabase/server";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import { getUserContext } from "@/lib/auth";
import DealsBoard from "@/components/deals/DealsBoard";
import type { Deal, Pipeline, Stage } from "@/lib/types";

export default async function DealsPage() {
  const supabase = await createClient();
  const ctx = await getUserContext();

  const [pipelinesRes, stagesRes, dealsRes, customFields, profilesRes] = await Promise.all([
    supabase.from("pipelines").select("*").is("deleted_at", null).order("display_order"),
    supabase.from("stages").select("*").order("display_order"),
    supabase
      .from("deals")
      .select("*, accounts(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    fetchCustomFieldDefs(supabase, "deals"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);

  const profiles = ((profilesRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
    (p) => ({ id: p.id, name: p.full_name || p.email || "User" }),
  );

  return (
    <DealsBoard
      pipelines={(pipelinesRes.data ?? []) as Pipeline[]}
      stages={(stagesRes.data ?? []) as Stage[]}
      initialDeals={(dealsRes.data ?? []) as Deal[]}
      userId={ctx?.userId ?? ""}
      isManager={ctx?.isAdmin ?? false}
      customFields={customFields}
      profiles={profiles}
    />
  );
}
