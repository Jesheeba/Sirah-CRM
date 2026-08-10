import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import NotificationsClient from "@/components/notifications/NotificationsClient";
import type { Notification, NotificationPreference } from "@/lib/types";

export default async function NotificationsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  const supabase = await createClient();

  const [notifRes, prefRes] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("notification_preferences").select("*"),
  ]);

  const prefs: Record<string, { in_app: boolean; email: boolean }> = {};
  for (const p of (prefRes.data ?? []) as NotificationPreference[])
    prefs[p.type] = { in_app: p.in_app, email: p.email };

  return (
    <NotificationsClient
      initial={(notifRes.data ?? []) as Notification[]}
      initialPrefs={prefs}
      userId={ctx.userId}
    />
  );
}
