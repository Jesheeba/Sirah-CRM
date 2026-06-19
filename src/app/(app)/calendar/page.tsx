import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import CalendarClient, { type CalTask } from "@/components/calendar/CalendarClient";
import type { CalendarEvent } from "@/lib/types";

export default async function CalendarPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  const supabase = await createClient();

  const [eventsRes, tasksRes, profileRes] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("*")
      .is("deleted_at", null)
      .order("starts_at", { ascending: true })
      .limit(1000),
    supabase
      .from("tasks")
      .select("id, title, status, due_at, assignee_id, owner_id")
      .not("due_at", "is", null)
      .is("deleted_at", null)
      .limit(1000),
    supabase.from("profiles").select("ics_token").eq("id", ctx.userId).maybeSingle(),
  ]);

  return (
    <CalendarClient
      initialEvents={(eventsRes.data ?? []) as CalendarEvent[]}
      tasks={(tasksRes.data ?? []) as CalTask[]}
      currentUserId={ctx.userId}
      canManageAll={ctx.isAdmin || ctx.isManager}
      icsToken={(profileRes.data as { ics_token?: string } | null)?.ics_token ?? null}
    />
  );
}
