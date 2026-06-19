import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type FeedRow = {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  kind: string;
};

// iCal UTC timestamp: 20260616T143000Z
function dt(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function dateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10).replace(/-/g, "");
}
function esc(s: string | null): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Public iCal feed. Calendar apps fetch this with no session, so it's allow-listed
 * in middleware and authorized solely by the per-user `?token=` (validated inside the
 * SECURITY DEFINER `fn_calendar_feed`, which bypasses RLS).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("missing token", { status: 400 });

  let rows: FeedRow[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("fn_calendar_feed", { p_token: token });
    rows = (data ?? []) as FeedRow[];
  } catch {
    rows = [];
  }

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sirah CRM//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CRM Calendar",
  ];
  for (const r of rows) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${r.kind}-${r.id}@sirah-crm`);
    lines.push(`DTSTAMP:${dt(new Date().toISOString())}`);
    if (r.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(r.starts_at)}`);
    } else {
      lines.push(`DTSTART:${dt(r.starts_at)}`);
      if (r.ends_at) lines.push(`DTEND:${dt(r.ends_at)}`);
    }
    lines.push(`SUMMARY:${esc(r.kind === "task" ? `☑ ${r.title ?? ""}` : r.title)}`);
    if (r.location) lines.push(`LOCATION:${esc(r.location)}`);
    if (r.description) lines.push(`DESCRIPTION:${esc(r.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="crm-calendar.ics"',
      "Cache-Control": "no-cache",
    },
  });
}
