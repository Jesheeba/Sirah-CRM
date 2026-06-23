import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import PipelinesClient from "./PipelinesClient";
import type { Pipeline, Stage } from "@/lib/types";

export default async function PipelinesPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/settings/branding");

  const admin = createAdminClient();

  const [{ data: pipelinesData }, { data: stagesData }] = await Promise.all([
    admin
      .from("pipelines")
      .select("*")
      .eq("tenant_id", ctx.tenantId!)
      .is("deleted_at", null)
      .order("display_order"),
    admin
      .from("stages")
      .select("*")
      .eq("tenant_id", ctx.tenantId!)
      .order("display_order"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Pipelines</h1>
        <p className="text-sm text-slate-500">
          Define the stages deals move through. Each pipeline has its own stages with win
          probability. The default pipeline is used when deals are created without a specific
          pipeline.
        </p>
      </div>

      <PipelinesClient
        initialPipelines={(pipelinesData ?? []) as Pipeline[]}
        initialStages={(stagesData ?? []) as Stage[]}
      />
    </div>
  );
}
