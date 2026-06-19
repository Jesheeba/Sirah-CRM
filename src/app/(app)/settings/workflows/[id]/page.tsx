import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import WorkflowEditor from "@/components/settings/WorkflowEditor";
import type {
  Workflow,
  WorkflowAction,
  WorkflowCondition,
  WorkflowRunLog,
  WorkflowTrigger,
} from "@/lib/types";

export default async function WorkflowEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only

  const { id } = await params;
  const supabase = await createClient();

  const { data: workflow } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!workflow) notFound();

  const [trigRes, condRes, actRes, logRes] = await Promise.all([
    supabase.from("workflow_triggers").select("*").eq("workflow_id", id).order("created_at"),
    supabase
      .from("workflow_conditions")
      .select("*")
      .eq("workflow_id", id)
      .order("group_no")
      .order("created_at"),
    supabase
      .from("workflow_actions")
      .select("*")
      .eq("workflow_id", id)
      .order("execution_order")
      .order("created_at"),
    supabase
      .from("workflow_run_logs")
      .select("*")
      .eq("workflow_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <WorkflowEditor
      workflow={workflow as Workflow}
      initialTriggers={(trigRes.data ?? []) as WorkflowTrigger[]}
      initialConditions={(condRes.data ?? []) as WorkflowCondition[]}
      initialActions={(actRes.data ?? []) as WorkflowAction[]}
      runLogs={(logRes.data ?? []) as WorkflowRunLog[]}
    />
  );
}
