import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmailConfig } from "@/lib/integrations";

const BATCH_SIZE = 500;

interface PendingNotification {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  title: string;
  link: string | null;
  created_at: string;
}

/**
 * Processes the daily notification email digest: batches every 'pending' notification
 * by user, checks each user's per-type email preference, sends one digest email per
 * user (not one email per event), and marks every row 'sent' or 'skipped' so it's never
 * rescanned. Called once per day from /api/workflows/tick.
 *
 * Returns counts for observability in the tick response.
 */
export async function processNotificationEmailDigest(
  admin: SupabaseClient,
): Promise<{ scanned: number; sent: number; skipped: number; usersEmailed: number }> {
  const { data: pending } = await admin
    .from("notifications")
    .select("id, tenant_id, user_id, type, title, link, created_at")
    .eq("email_status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  const rows = (pending ?? []) as PendingNotification[];
  if (!rows.length) return { scanned: 0, sent: 0, skipped: 0, usersEmailed: 0 };

  const { data: prefRows } = await admin
    .from("notification_preferences")
    .select("user_id, type, email")
    .eq("email", true);

  const emailEnabled = new Set(
    ((prefRows ?? []) as { user_id: string; type: string }[]).map((p) => `${p.user_id}:${p.type}`),
  );

  const eligible = rows.filter((n) => emailEnabled.has(`${n.user_id}:${n.type}`));
  const ineligible = rows.filter((n) => !emailEnabled.has(`${n.user_id}:${n.type}`));

  if (ineligible.length) {
    await admin
      .from("notifications")
      .update({ email_status: "skipped" })
      .in("id", ineligible.map((n) => n.id));
  }

  if (!eligible.length) {
    return { scanned: rows.length, sent: 0, skipped: ineligible.length, usersEmailed: 0 };
  }

  const byUser = new Map<string, PendingNotification[]>();
  for (const n of eligible) {
    const list = byUser.get(n.user_id) ?? [];
    list.push(n);
    byUser.set(n.user_id, list);
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  let sent = 0;
  let usersEmailed = 0;

  for (const [userId, items] of byUser) {
    const tenantId = items[0].tenant_id;
    const cfg = await resolveEmailConfig(tenantId);
    if (cfg.mode === "link" || !cfg.apiKey || !cfg.fromEmail) {
      continue; // no provider configured — leave 'pending', retried on tomorrow's run
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();
    const toEmail = (profile as { email?: string } | null)?.email;
    if (!toEmail) continue;

    const firstName = (profile as { full_name?: string } | null)?.full_name?.split(" ")[0] ?? "";
    const count = items.length;
    const subject = `${count} notification${count > 1 ? "s" : ""} from your CRM`;
    const lines = items.map((n) => `- ${n.title}${n.link ? ` (${appUrl}${n.link})` : ""}`);
    const textBody = [
      `Hi ${firstName || "there"},`,
      "",
      ...lines,
      "",
      `Manage what you're emailed about: ${appUrl}/notifications`,
    ].join("\n");
    const htmlBody = textBody
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
    const fromHeader = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromHeader, to: [toEmail], subject, text: textBody, html: htmlBody }),
    });

    if (res.ok) {
      await admin
        .from("notifications")
        .update({ email_status: "sent", email_sent_at: new Date().toISOString() })
        .in("id", items.map((n) => n.id));
      sent += items.length;
      usersEmailed++;
    }
    // On failure, rows stay 'pending' — retried on the next digest run.
  }

  return { scanned: rows.length, sent, skipped: ineligible.length, usersEmailed };
}
