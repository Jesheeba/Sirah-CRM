import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import TaskDetailClient from "@/components/tasks/TaskDetailClient";
import type { Member } from "@/components/tasks/TasksClient";
import type { Task } from "@/lib/types";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: task }, membersRes] = await Promise.all([
    supabase.from("tasks").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);
  if (!task) notFound();

  const t = task as Task;
  const canManage =
    ctx.isAdmin || ctx.isManager || t.owner_id === ctx.userId || t.assignee_id === ctx.userId;

  return (
    <TaskDetailClient task={t} members={(membersRes.data ?? []) as Member[]} canManage={canManage} />
  );
}
