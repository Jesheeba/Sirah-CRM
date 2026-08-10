import type { SupabaseClient } from "@supabase/supabase-js";
import { REPORT_DEFS, money, toCsv, type ReportColumn } from "@/lib/reports";
import { resolveEmailConfig, formatFrom } from "@/lib/integrations";
import type { ReportType } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ScheduleRow {
  id: string;
  tenant_id: string;
  name: string;
  report_type: ReportType;
  filters: Record<string, string>;
  date_range: "last_7_days" | "last_30_days" | "this_month" | "last_month" | "all_time";
  cadence: "daily" | "weekly" | "monthly";
  recipient_emails: string[];
  last_sent_at: string | null;
}

function isDue(s: ScheduleRow, now: Date): boolean {
  if (!s.last_sent_at) return true;
  const last = new Date(s.last_sent_at);
  if (s.cadence === "daily") return now.getTime() - last.getTime() >= DAY_MS - 60_000; // small slack for cron jitter
  if (s.cadence === "weekly") return now.getTime() - last.getTime() >= 7 * DAY_MS;
  // monthly: due once the calendar month has rolled over since the last send
  return now.getFullYear() !== last.getFullYear() || now.getMonth() !== last.getMonth();
}

function dateBounds(range: ScheduleRow["date_range"], now: Date): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (range) {
    case "last_7_days":
      return { from: iso(new Date(now.getTime() - 7 * DAY_MS)), to: iso(now) };
    case "last_30_days":
      return { from: iso(new Date(now.getTime() - 30 * DAY_MS)), to: iso(now) };
    case "this_month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case "last_month":
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "all_time":
      return { from: "", to: "" };
  }
}

/**
 * Runs every active report schedule that's due, emails the CSV to its recipients.
 * No PDF — see BUILD_BLOCKERS.md for why (no server-side PDF renderer in this app;
 * the only "PDF" path anywhere is browser print-to-PDF, which a cron can't drive).
 * Called once per day from /api/workflows/tick.
 */
export async function processReportSchedules(
  admin: SupabaseClient,
): Promise<{ scanned: number; sent: number }> {
  const { data } = await admin.from("report_schedules").select("*").eq("is_active", true);
  const schedules = (data ?? []) as ScheduleRow[];
  if (!schedules.length) return { scanned: 0, sent: 0 };

  const now = new Date();
  const due = schedules.filter((s) => isDue(s, now));
  if (!due.length) return { scanned: schedules.length, sent: 0 };

  const { data: profiles } = await admin.from("profiles").select("id, full_name, email");
  const memberById = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((m) => [m.id, m]),
  );
  const memberName = (id: string) => {
    const m = memberById.get(id);
    return m ? m.full_name || m.email || "(member)" : "—";
  };
  const cellText = (col: ReportColumn, row: Record<string, unknown>): string => {
    if (col.compute) return col.compute(row);
    const raw = row[col.key];
    if (col.kind === "member") return memberName(String(raw ?? ""));
    if (col.kind === "currency") return raw != null ? money(Number(raw), String(row.currency || "INR")) : "";
    if (col.kind === "date") return raw ? new Date(String(raw)).toLocaleDateString() : "";
    return raw == null || raw === "" ? "" : String(raw);
  };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  let sent = 0;

  for (const schedule of due) {
    if (!schedule.recipient_emails.length) continue;

    const def = REPORT_DEFS[schedule.report_type];
    const { from, to } = dateBounds(schedule.date_range, now);

    let q = admin.from(def.table).select(def.select).eq("tenant_id", schedule.tenant_id);
    if (def.hasDeletedAt) q = q.is("deleted_at", null);
    if (def.baseFilter) for (const [k, v] of Object.entries(def.baseFilter)) q = q.eq(k, v);
    for (const [k, v] of Object.entries(schedule.filters ?? {})) if (v) q = q.eq(k, v);
    if (from) q = q.gte(def.dateField, from);
    if (to) q = q.lte(def.dateField, `${to}T23:59:59`);
    q = q.order(def.dateField, { ascending: false }).limit(1000);

    const { data: rows } = await q;
    const data = (rows ?? []) as unknown as Record<string, unknown>[];

    const cfg = await resolveEmailConfig(schedule.tenant_id);
    if (cfg.mode === "link" || !cfg.apiKey || !cfg.fromEmail) continue; // no provider — retried next due cycle

    const csv = toCsv(def.columns.map((c) => c.label), data.map((r) => def.columns.map((c) => cellText(c, r))));
    const csvBase64 = Buffer.from(csv, "utf-8").toString("base64");
    const printLink = appUrl ? `${appUrl}/reports/print?type=${schedule.report_type}` : null;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: formatFrom(cfg.fromEmail, cfg.fromName),
        to: schedule.recipient_emails,
        subject: `${schedule.name} — ${def.label} report`,
        text: [
          `Attached: ${data.length} row(s) from the ${def.label} report ("${schedule.name}").`,
          printLink ? `View a formatted copy: ${printLink}` : null,
        ].filter(Boolean).join("\n\n"),
        attachments: [{ filename: `${schedule.report_type}-report.csv`, content: csvBase64 }],
      }),
    });

    if (res.ok) {
      await admin.from("report_schedules").update({ last_sent_at: now.toISOString() }).eq("id", schedule.id);
      sent++;
    }
  }

  return { scanned: schedules.length, sent };
}
