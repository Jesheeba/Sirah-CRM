import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import TasksClient, { type Member } from "@/components/tasks/TasksClient";
import type { Task } from "@/lib/types";

export default async function TasksPage() {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;

  const [tasksRes, membersRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);

  return (
    <TasksClient
      initial={(tasksRes.data ?? []) as Task[]}
      members={(membersRes.data ?? []) as Member[]}
      userId={ctx.userId}
      defaultMine={ctx.isRep}
      canSeeTeam={ctx.isManager || ctx.isAdmin}
    />
  );
}
