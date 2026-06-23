import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolves which messaging credentials to use for a tenant, preserving the app's
 * graceful-degradation behaviour:
 *   1. "tenant_cloud"  — tenant configured the official Meta WhatsApp Cloud API.
 *   2. "tenant_device" — tenant configured an unofficial device-based provider (UltraMsg-compatible).
 *   3. "env"           — no tenant config, but deployment-wide env vars are present (Cloud API).
 *   4. "link"          — neither; the caller falls back to a mailto:/wa.me link.
 *
 * Cloud API is preferred when both are configured. A future explicit "active provider" toggle
 * would override this priority.
 *
 * Secrets (access_token, webhook_token) are read via the service-role client — those columns are
 * unreadable by the anon/authenticated roles. Every query is manually scoped to the tenant.
 */
export type ResolveMode = "tenant" | "env" | "link";
export type WhatsAppMode = "tenant_cloud" | "tenant_device" | "env" | "link";

export interface EmailConfig {
  mode: ResolveMode;
  fromEmail: string | null;
  fromName: string | null;
  apiKey: string | null;
}

export interface WhatsAppConfig {
  mode: WhatsAppMode;
  phoneId: string | null;
  accessToken: string | null;
  /** Device provider base URL (e.g. https://api.ultramsg.com). Only set when mode=tenant_device. */
  apiEndpoint?: string | null;
}

export async function resolveEmailConfig(tenantId: string | null): Promise<EmailConfig> {
  if (tenantId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integration_settings")
      .select("is_enabled, from_email, from_name, api_key")
      .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
      .eq("channel", "email")
      .maybeSingle();

    if (data?.is_enabled && data.api_key && data.from_email) {
      return {
        mode: "tenant",
        fromEmail: data.from_email,
        fromName: data.from_name ?? null,
        apiKey: data.api_key,
      };
    }
  }

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    return {
      mode: "env",
      fromEmail: process.env.EMAIL_FROM,
      fromName: null,
      apiKey: process.env.RESEND_API_KEY,
    };
  }

  return { mode: "link", fromEmail: null, fromName: null, apiKey: null };
}

export async function resolveWhatsAppConfig(
  tenantId: string | null,
): Promise<WhatsAppConfig> {
  if (tenantId) {
    const admin = createAdminClient();

    // Check official Cloud API first (preferred)
    const { data: cloud } = await admin
      .from("integration_settings")
      .select("is_enabled, phone_id, access_token")
      .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
      .eq("channel", "whatsapp")
      .maybeSingle();

    if (cloud?.is_enabled && cloud.access_token && cloud.phone_id) {
      return { mode: "tenant_cloud", phoneId: cloud.phone_id, accessToken: cloud.access_token };
    }

    // Fall back to device-based provider
    const { data: device } = await admin
      .from("integration_settings")
      .select("is_enabled, phone_id, access_token, api_endpoint")
      .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
      .eq("channel", "whatsapp_device")
      .maybeSingle();

    if (device?.is_enabled && device.access_token && device.phone_id) {
      return {
        mode: "tenant_device",
        phoneId: device.phone_id,
        accessToken: device.access_token,
        apiEndpoint: device.api_endpoint ?? "https://api.ultramsg.com",
      };
    }
  }

  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    return {
      mode: "env",
      phoneId: process.env.WHATSAPP_PHONE_ID,
      accessToken: process.env.WHATSAPP_TOKEN,
    };
  }

  return { mode: "link", phoneId: null, accessToken: null };
}

/** Builds an RFC 5322 From header, adding a display name when present. */
export function formatFrom(email: string, name: string | null): string {
  return name?.trim() ? `${name.trim()} <${email}>` : email;
}
