"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { normalizePhone, waMeUrl } from "@/lib/whatsapp";
import { resolveWhatsAppConfig } from "@/lib/integrations";
import type { CommRelatedType } from "@/lib/types";

export interface SendWhatsAppInput {
  to_phone: string;
  to_name?: string | null;
  body: string;
  template_id?: string | null;
  related_to_type?: CommRelatedType | null;
  related_to_id?: string | null;
  quotation_id?: string | null;
}

export interface SendWhatsAppResult {
  ok: boolean;
  /** When no provider is configured, the client opens this wa.me link. */
  waUrl?: string;
  error?: string;
  status?: string;
}

/**
 * True when the Meta WhatsApp Cloud API is wired for the current tenant (real send +
 * receipts) — either the tenant's own credentials or the global env fallback.
 */
export async function whatsappProviderEnabled(): Promise<boolean> {
  const ctx = await getUserContext();
  const cfg = await resolveWhatsAppConfig(ctx?.tenantId ?? null);
  return cfg.mode !== "link";
}

/**
 * Logs an outbound WhatsApp message to `communications` (channel='whatsapp') and sends it.
 *  - Provider configured → POSTs to the Meta Cloud API; receipts arrive via the webhook.
 *  - Otherwise           → returns a wa.me link for the client to open; the row is still logged.
 */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  const phone = normalizePhone(input.to_phone);
  if (!phone) return { ok: false, error: "A valid phone number is required." };

  const supabase = await createClient();
  const cfg = await resolveWhatsAppConfig(ctx.tenantId);
  const providerOn = cfg.mode !== "link";

  const { data: row, error: insErr } = await supabase
    .from("communications")
    .insert({
      channel: "whatsapp",
      direction: "outbound",
      status: providerOn ? "queued" : "sent",
      to_phone: phone,
      to_name: input.to_name?.trim() || null,
      body: input.body ?? "",
      template_id: input.template_id || null,
      related_to_type: input.related_to_type || null,
      related_to_id: input.related_to_id || null,
      quotation_id: input.quotation_id || null,
      provider: providerOn ? "whatsapp_cloud" : null,
    })
    .select("id")
    .single();

  if (insErr || !row) return { ok: false, error: insErr?.message ?? "Could not log message." };

  if (!providerOn) {
    return { ok: true, status: "sent", waUrl: waMeUrl(phone, input.body) };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${cfg.phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: input.body ?? "" },
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
      return { ok: false, error: json.error?.message ?? `Send failed (${res.status}).`, status: "failed" };
    }
    await supabase
      .from("communications")
      .update({ status: "sent", provider_message_id: json.messages?.[0]?.id ?? null })
      .eq("id", row.id);
    return { ok: true, status: "sent" };
  } catch (e) {
    await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
    return { ok: false, error: e instanceof Error ? e.message : "Send failed.", status: "failed" };
  }
}
