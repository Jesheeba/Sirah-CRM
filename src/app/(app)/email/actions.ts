"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { bodyToHtml, mailtoUrl } from "@/lib/email";
import { formatFrom, resolveEmailConfig } from "@/lib/integrations";
import type { CommRelatedType } from "@/lib/types";

export interface SendEmailInput {
  to_email: string;
  to_name?: string | null;
  subject: string;
  body: string;
  cc?: string | null;
  bcc?: string | null;
  template_id?: string | null;
  related_to_type?: CommRelatedType | null;
  related_to_id?: string | null;
  quotation_id?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  /** When no provider is configured, the client opens this to send via the user's mail app. */
  mailto?: string;
  error?: string;
  status?: string;
}

/**
 * True when a transactional provider is wired for the current tenant (real send +
 * open tracking) — either the tenant's own Resend credentials or the global env fallback.
 */
export async function emailProviderEnabled(): Promise<boolean> {
  const ctx = await getUserContext();
  const cfg = await resolveEmailConfig(ctx?.tenantId ?? null);
  return cfg.mode !== "link";
}

/**
 * Logs an outbound email to `communications` and sends it.
 *  - Provider configured  → sends real HTML via Resend with a tracking pixel.
 *  - Otherwise            → returns a mailto: URL for the client to open; the row
 *                           is still recorded so the activity/inbox is complete.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!input.to_email?.trim()) return { ok: false, error: "Recipient email is required." };

  const supabase = await createClient();
  const cfg = await resolveEmailConfig(ctx.tenantId);
  const providerOn = cfg.mode !== "link";
  const fromEmail = cfg.fromEmail;

  // 1) Record the message first so we have its open_token for the tracking pixel.
  const { data: row, error: insErr } = await supabase
    .from("communications")
    .insert({
      channel: "email",
      direction: "outbound",
      status: providerOn ? "queued" : "sent",
      to_email: input.to_email.trim(),
      to_name: input.to_name?.trim() || null,
      from_email: fromEmail,
      cc: input.cc?.trim() || null,
      bcc: input.bcc?.trim() || null,
      subject: input.subject ?? "",
      body: input.body ?? "",
      template_id: input.template_id || null,
      related_to_type: input.related_to_type || null,
      related_to_id: input.related_to_id || null,
      quotation_id: input.quotation_id || null,
      provider: providerOn ? "resend" : null,
    })
    .select("id, open_token")
    .single();

  if (insErr || !row) return { ok: false, error: insErr?.message ?? "Could not log email." };

  // 2a) No provider → hand back a mailto for the user's mail client.
  if (!providerOn) {
    return { ok: true, status: "sent", mailto: mailtoUrl(input.to_email.trim(), input.subject, input.body) };
  }

  // 2b) Provider send via Resend, with a 1x1 open-tracking pixel.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    const pixel = appUrl
      ? `<img src="${appUrl}/api/email/open?t=${row.open_token}" width="1" height="1" alt="" style="display:none"/>`
      : "";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatFrom(fromEmail!, cfg.fromName),
        to: [input.to_email.trim()],
        ...(input.cc?.trim() ? { cc: [input.cc.trim()] } : {}),
        ...(input.bcc?.trim() ? { bcc: [input.bcc.trim()] } : {}),
        subject: input.subject || "(no subject)",
        html: `${bodyToHtml(input.body)}${pixel}`,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
      return { ok: false, error: json.message ?? `Send failed (${res.status}).`, status: "failed" };
    }
    await supabase
      .from("communications")
      .update({ status: "sent", provider_message_id: json.id ?? null })
      .eq("id", row.id);
    return { ok: true, status: "sent" };
  } catch (e) {
    await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
    return { ok: false, error: e instanceof Error ? e.message : "Send failed.", status: "failed" };
  }
}

/** Records an inbound email manually (until two-way sync exists). */
export async function logInboundEmail(input: {
  from_email: string;
  subject: string;
  body: string;
  related_to_type?: CommRelatedType | null;
  related_to_id?: string | null;
}): Promise<SendEmailResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();
  const { error } = await supabase.from("communications").insert({
    channel: "email",
    direction: "inbound",
    status: "received",
    from_email: input.from_email.trim() || null,
    subject: input.subject ?? "",
    body: input.body ?? "",
    related_to_type: input.related_to_type || null,
    related_to_id: input.related_to_id || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, status: "received" };
}
