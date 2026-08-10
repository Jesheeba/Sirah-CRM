"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { ReportCadence, ReportDateRange, ReportSchedule, ReportType } from "@/lib/types";

const PATH = "/reports";

export async function createReportSchedule(data: {
  name: string;
  report_type: ReportType;
  filters: Record<string, string>;
  date_range: ReportDateRange;
  cadence: ReportCadence;
  recipient_emails: string[];
}): Promise<{ ok: boolean; error?: string; schedule?: ReportSchedule }> {
  const ctx = await getUserContext();
  if (!ctx || !(ctx.isAdmin || ctx.isManager)) return { ok: false, error: "Manager or Admin access required" };
  if (!data.name.trim()) return { ok: false, error: "Name the schedule." };
  if (!data.recipient_emails.length) return { ok: false, error: "Add at least one recipient email." };

  const supabase = await createClient();
  const { data: schedule, error } = await supabase
    .from("report_schedules")
    .insert({
      name: data.name.trim(),
      report_type: data.report_type,
      filters: data.filters,
      date_range: data.date_range,
      cadence: data.cadence,
      recipient_emails: data.recipient_emails,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, schedule: schedule as ReportSchedule };
}

export async function toggleReportSchedule(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("report_schedules").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteReportSchedule(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("report_schedules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
