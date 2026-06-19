import { createClient } from "@/lib/supabase/server";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import DealsBoard from "@/components/deals/DealsBoard";
import type { Deal, Pipeline, Stage } from "@/lib/types";

export default async function DealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [pipelinesRes, stagesRes, dealsRes, customFields] = await Promise.all([
    supabase.from("pipelines").select("*").is("deleted_at", null).order("display_order"),
    supabase.from("stages").select("*").order("display_order"),
    supabase
      .from("deals")
      .select("*, accounts(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    fetchCustomFieldDefs(supabase, "deals"),
  ]);

  return (
    <DealsBoard
      pipelines={(pipelinesRes.data ?? []) as Pipeline[]}
      stages={(stagesRes.data ?? []) as Stage[]}
      initialDeals={(dealsRes.data ?? []) as Deal[]}
      userId={user!.id}
      customFields={customFields}
    />
  );
}
