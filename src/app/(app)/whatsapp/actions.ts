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
 * True when any WhatsApp provider (Cloud API or device) is wired for the current tenant.
 */
export async function whatsappProviderEnabled(): Promise<boolean> {
  const ctx = await getUserContext();
  const cfg = await resolveWhatsAppConfig(ctx?.tenantId ?? null);
  return cfg.mode !== "link";
}

/**
 * Logs an outbound WhatsApp message to `communications` and sends it.
 *
 * Provider priority (from resolveWhatsAppConfig):
 *   tenant_cloud  → Meta WhatsApp Cloud API (official)
 *   tenant_device → UltraMsg-compatible device API (unofficial)
 *   env           → Meta Cloud API via env vars
 *   link          → no provider; returns wa.me link, still logs the row
 *
 * normalizePhone strips all non-digits (the '+' too), giving the digits-only format
 * that both wa.me and UltraMsg expect.
 */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  const phone = normalizePhone(input.to_phone);
  if (!phone) return { ok: false, error: "A valid phone number is required." };

  const supabase = await createClient();
  const cfg = await resolveWhatsAppConfig(ctx.tenantId);
  const providerOn = cfg.mode !== "link";
  const isDevice = cfg.mode === "tenant_device";

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
      // channel='whatsapp' is the medium; provider distinguishes the transport
      provider: isDevice ? "whatsapp_device" : providerOn ? "whatsapp_cloud" : null,
    })
    .select("id")
    .single();

  if (insErr || !row) return { ok: false, error: insErr?.message ?? "Could not log message." };

  if (!providerOn) {
    return { ok: true, status: "sent", waUrl: waMeUrl(phone, input.body) };
  }

  try {
    if (isDevice) {
      return await sendViaDevice(supabase, row.id, phone, input.body, cfg.phoneId!, cfg.accessToken!, cfg.apiEndpoint!);
    }
    return await sendViaCloudApi(supabase, row.id, phone, input.body, cfg.phoneId!, cfg.accessToken!);
  } catch (e) {
    await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
    return { ok: false, error: e instanceof Error ? e.message : "Send failed.", status: "failed" };
  }
}

export interface SendTemplateInput {
  to_phone: string;
  to_name?: string | null;
  templateName: string;
  languageCode: string;
  components?: unknown[];
  related_to_type?: CommRelatedType | null;
  related_to_id?: string | null;
  quotation_id?: string | null;
}

/**
 * Sends a WhatsApp template message via the Meta Cloud API.
 * Templates are required for business-initiated conversations (outside the 24-hour window).
 * Only works with Cloud API (tenant_cloud or env mode) — device providers don't support templates.
 */
export async function sendTemplate(input: SendTemplateInput): Promise<SendWhatsAppResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  const phone = normalizePhone(input.to_phone);
  if (!phone) return { ok: false, error: "A valid phone number is required." };

  const cfg = await resolveWhatsAppConfig(ctx.tenantId);
  if (cfg.mode !== "tenant_cloud" && cfg.mode !== "env") {
    return { ok: false, error: "Templates require the Meta WhatsApp Cloud API." };
  }

  const supabase = await createClient();
  const { data: row, error: insErr } = await supabase
    .from("communications")
    .insert({
      channel: "whatsapp",
      provider: "whatsapp_cloud",
      direction: "outbound",
      status: "queued",
      to_phone: phone,
      to_name: input.to_name?.trim() || null,
      body: `Template: ${input.templateName}`,
      related_to_type: input.related_to_type || null,
      related_to_id: input.related_to_id || null,
      quotation_id: input.quotation_id || null,
    })
    .select("id")
    .single();

  if (insErr || !row) return { ok: false, error: insErr?.message ?? "Could not log message." };

  try {
    const res = await fetch(`https://graph.facebook.com/v22.0/${cfg.phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          components: input.components ?? [],
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
      return {
        ok: false,
        error: json.error?.message ?? `Template send failed (${res.status}).`,
        status: "failed",
      };
    }
    await supabase
      .from("communications")
      .update({ status: "sent", provider_message_id: json.messages?.[0]?.id ?? null })
      .eq("id", row.id);
    return { ok: true, status: "sent" };
  } catch (e) {
    await supabase.from("communications").update({ status: "failed" }).eq("id", row.id);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Template send failed.",
      status: "failed",
    };
  }
}

async function sendViaCloudApi(
  supabase: Awaited<ReturnType<typeof createClient>>,
  commId: string,
  phone: string,
  body: string,
  phoneId: string,
  accessToken: string,
): Promise<SendWhatsAppResult> {
  const res = await fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    await supabase.from("communications").update({ status: "failed" }).eq("id", commId);
    return { ok: false, error: json.error?.message ?? `Send failed (${res.status}).`, status: "failed" };
  }
  await supabase
    .from("communications")
    .update({ status: "sent", provider_message_id: json.messages?.[0]?.id ?? null })
    .eq("id", commId);
  return { ok: true, status: "sent" };
}

async function sendViaDevice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  commId: string,
  phone: string,
  body: string,
  instanceId: string,
  token: string,
  apiEndpoint: string,
): Promise<SendWhatsAppResult> {
  // UltraMsg format: digits-only phone (no '+'), which normalizePhone already produces
  const base = apiEndpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}/${instanceId}/messages/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, to: phone, body }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    sent?: boolean;
    error?: string;
  };
  if (!res.ok || !json.sent) {
    await supabase.from("communications").update({ status: "failed" }).eq("id", commId);
    return { ok: false, error: json.error ?? `Device send failed (${res.status}).`, status: "failed" };
  }
  await supabase
    .from("communications")
    .update({ status: "sent", provider_message_id: json.id ?? null })
    .eq("id", commId);
  return { ok: true, status: "sent" };
}
