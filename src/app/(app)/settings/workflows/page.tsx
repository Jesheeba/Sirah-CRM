import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import WorkflowsClient from "@/components/settings/WorkflowsClient";
import type { Workflow } from "@/lib/types";

export default async function WorkflowsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only

  const supabase = await createClient();
  const { data } = await supabase
    .from("workflows")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Workflows</h1>
        <p className="text-sm text-slate-500">
          Automate tasks and field updates with “if this, then that” rules that run when records change.
        </p>
      </div>
      <WorkflowsClient initial={(data ?? []) as Workflow[]} />
    </div>
  );
}
