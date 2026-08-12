import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmailConfig, resolveWhatsAppConfig, formatFrom } from "@/lib/integrations";
import { bodyToTrackedHtml, mergeTemplate } from "@/lib/email";
import { normalizePhone, WHATSAPP_GRAPH } from "@/lib/whatsapp";

const BATCH_SIZE = 100;

interface DueEnrollment {
  id: string;
  tenant_id: string;
  sequence_id: string;
  lead_id: string;
  current_step: number;
  enrolled_by: string;
  sequences: { is_active: boolean } | { is_active: boolean }[] | null;
}

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  owner_id: string | null;
}

interface StepRow {
  step_order: number;
  channel: "email" | "whatsapp" | "task";
  delay_hours: number;
  content: { subject?: string; body?: string; title?: string };
}

function isActiveSequence(s: DueEnrollment["sequences"]): boolean {
  const row = Array.isArray(s) ? s[0] : s;
  return row?.is_active ?? false;
}

/** A lead exits its sequence the moment they reply, or once they're no longer a live prospect. */
async function shouldExit(
  admin: SupabaseClient,
  lead: LeadRow,
  enrolledAt: string,
): Promise<string | null> {
  if (["qualified", "unqualified", "converted"].includes(lead.status)) {
    return `lead status changed to ${lead.status}`;
  }
  const { count } = await admin
    .from("communications")
    .select("id", { count: "exact", head: true })
    .eq("related_to_type", "lead")
    .eq("related_to_id", lead.id)
    .eq("direction", "inbound")
    .gte("created_at", enrolledAt);
  if ((count ?? 0) > 0) return "lead replied";
  return null;
}

async function runEmailStep(
  admin: SupabaseClient,
  tenantId: string,
  lead: LeadRow,
  step: StepRow,
  fallbackOwnerId: string,
): Promise<string | null> {
  if (!lead.email) return "lead has no email address";
  const cfg = await resolveEmailConfig(tenantId);
  if (cfg.mode === "link" || !cfg.apiKey || !cfg.fromEmail) return "no email provider configured";

  const vars = { first_name: lead.first_name, last_name: lead.last_name, company: lead.company };
  const subject = mergeTemplate(step.content.subject ?? "", vars);
  const body = mergeTemplate(step.content.body ?? "", vars);

  const { data: row } = await admin
    .from("communications")
    .insert({
      tenant_id: tenantId,
      channel: "email",
      direction: "outbound",
      status: "queued",
      to_email: lead.email,
      from_email: cfg.fromEmail,
      subject,
      body,
      provider: "resend",
      related_to_type: "lead",
      related_to_id: lead.id,
      owner_id: lead.owner_id ?? fallbackOwnerId,
    })
    .select("id, open_token")
    .single();
  if (!row) return "failed to log outbound email";

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const pixel = appUrl ? `<img src="${appUrl}/api/email/open?t=${row.open_token}" width="1" height="1" alt="" style="display:none"/>` : "";
  const html = bodyToTrackedHtml(
    body,
    appUrl ? (url) => `${appUrl}/api/email/click?t=${row.open_token}&u=${encodeURIComponent(url)}` : undefined,
  );

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: formatFrom(cfg.fromEmail, cfg.fromName), to: [lead.email], subject, html: `${html}${pixel}` }),
  });

  if (!res.ok) {
    await admin.from("communications").update({ status: "failed" }).eq("id", row.id);
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    return json.message ?? `email send failed (${res.status})`;
  }
  await admin.from("communications").update({ status: "sent" }).eq("id", row.id);
  return null;
}

async function runWhatsAppStep(
  admin: SupabaseClient,
  tenantId: string,
  lead: LeadRow,
  step: StepRow,
  fallbackOwnerId: string,
): Promise<string | null> {
  const phone = normalizePhone(lead.phone ?? "");
  if (!phone) return "lead has no phone number";

  const { data: optout } = await admin
    .from("whatsapp_optouts")
    .select("phone")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();
  if (optout) return null; // silently skip, not an error — this lead opted out

  const cfg = await resolveWhatsAppConfig(tenantId);
  if (cfg.mode === "link") return "no WhatsApp provider configured";

  const vars = { first_name: lead.first_name, last_name: lead.last_name, company: lead.company };
  const body = mergeTemplate(step.content.body ?? "", vars);
  const isDevice = cfg.mode === "tenant_device";

  const { data: row } = await admin
    .from("communications")
    .insert({
      tenant_id: tenantId,
      channel: "whatsapp",
      direction: "outbound",
      status: "queued",
      to_phone: phone,
      body,
      provider: isDevice ? "whatsapp_device" : "whatsapp_cloud",
      related_to_type: "lead",
      related_to_id: lead.id,
      owner_id: lead.owner_id ?? fallbackOwnerId,
    })
    .select("id")
    .single();
  if (!row) return "failed to log outbound message";

  try {
    const res = isDevice
      ? await fetch(`${cfg.apiEndpoint!.replace(/\/+$/, "")}/${cfg.phoneId}/messages/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: cfg.accessToken, to: phone, body }),
        })
      : await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH}/${cfg.phoneId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body } }),
        });
    if (!res.ok) {
      await admin.from("communications").update({ status: "failed" }).eq("id", row.id);
      return `whatsapp send failed (${res.status})`;
    }
    await admin.from("communications").update({ status: "sent" }).eq("id", row.id);
    return null;
  } catch (e) {
    await admin.from("communications").update({ status: "failed" }).eq("id", row.id);
    return e instanceof Error ? e.message : "whatsapp send failed";
  }
}

async function runTaskStep(admin: SupabaseClient, tenantId: string, lead: LeadRow, step: StepRow): Promise<string | null> {
  const { error } = await admin.from("tasks").insert({
    tenant_id: tenantId,
    title: mergeTemplate(step.content.title ?? "Follow up", { first_name: lead.first_name, last_name: lead.last_name, company: lead.company }),
    related_to_type: "lead",
    related_to_id: lead.id,
    assignee_id: lead.owner_id,
    owner_id: lead.owner_id,
    due_at: new Date().toISOString(),
  });
  return error?.message ?? null;
}

/**
 * Advances every due sequence enrollment by one step: checks exit conditions (reply, or
 * the lead moving out of an active-prospect status), executes the current step's channel
 * action, then schedules the next step (or completes). Runs once per day from
 * /api/workflows/tick — see BUILD_BLOCKERS.md for why step delays are effectively
 * "next business day," not literal hours, under the current Vercel Hobby cron.
 */
export async function processSequenceEnrollments(
  admin: SupabaseClient,
): Promise<{ scanned: number; executed: number; exited: number; completed: number }> {
  const { data } = await admin
    .from("sequence_enrollments")
    .select("id, tenant_id, sequence_id, lead_id, current_step, enrolled_by, enrolled_at, sequences!inner(is_active)")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  const due = (data ?? []) as unknown as (DueEnrollment & { enrolled_at: string })[];
  if (!due.length) return { scanned: 0, executed: 0, exited: 0, completed: 0 };

  let executed = 0, exited = 0, completed = 0;

  for (const enr of due) {
    if (!isActiveSequence(enr.sequences)) continue; // paused sequence — leave enrollment as-is, re-checked tomorrow

    const { data: lead } = await admin
      .from("leads")
      .select("id, first_name, last_name, company, email, phone, status, owner_id")
      .eq("id", enr.lead_id)
      .maybeSingle();
    if (!lead) {
      await admin.from("sequence_enrollments").update({ status: "stopped", stop_reason: "lead deleted" }).eq("id", enr.id);
      exited++;
      continue;
    }

    const exitReason = await shouldExit(admin, lead as LeadRow, enr.enrolled_at);
    if (exitReason) {
      await admin.from("sequence_enrollments").update({ status: "stopped", stop_reason: exitReason }).eq("id", enr.id);
      exited++;
      continue;
    }

    const { data: step } = await admin
      .from("sequence_steps")
      .select("step_order, channel, delay_hours, content")
      .eq("sequence_id", enr.sequence_id)
      .eq("step_order", enr.current_step)
      .maybeSingle();
    if (!step) {
      await admin.from("sequence_enrollments").update({ status: "completed" }).eq("id", enr.id);
      completed++;
      continue;
    }

    const stepError =
      step.channel === "email"
        ? await runEmailStep(admin, enr.tenant_id, lead as LeadRow, step as StepRow, enr.enrolled_by)
        : step.channel === "whatsapp"
          ? await runWhatsAppStep(admin, enr.tenant_id, lead as LeadRow, step as StepRow, enr.enrolled_by)
          : await runTaskStep(admin, enr.tenant_id, lead as LeadRow, step as StepRow);
    executed++;

    const { data: nextStep } = await admin
      .from("sequence_steps")
      .select("delay_hours")
      .eq("sequence_id", enr.sequence_id)
      .eq("step_order", enr.current_step + 1)
      .maybeSingle();

    if (nextStep) {
      await admin
        .from("sequence_enrollments")
        .update({
          current_step: enr.current_step + 1,
          next_run_at: new Date(Date.now() + nextStep.delay_hours * 3600_000).toISOString(),
          last_error: stepError,
        })
        .eq("id", enr.id);
    } else {
      await admin
        .from("sequence_enrollments")
        .update({ status: "completed", last_error: stepError })
        .eq("id", enr.id);
      completed++;
    }
  }

  return { scanned: due.length, executed, exited, completed };
}
