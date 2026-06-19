import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolves which messaging credentials to use for a tenant, preserving the app's
 * graceful-degradation behaviour:
 *   1. "tenant" — the tenant configured & enabled its own provider credentials.
 *   2. "env"    — no tenant config, but deployment-wide env vars are present.
 *   3. "link"   — neither; the caller falls back to a mailto:/wa.me link.
 *
 * Secrets are read via the service-role client (the secret columns are unreadable by
 * the anon/authenticated roles). Every query is manually scoped to the tenant.
 */
export type ResolveMode = "tenant" | "env" | "link";

export interface EmailConfig {
  mode: ResolveMode;
  fromEmail: string | null;
  fromName: string | null;
  apiKey: string | null;
}

export interface WhatsAppConfig {
  mode: ResolveMode;
  phoneId: string | null;
  accessToken: string | null;
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
    const { data } = await admin
      .from("integration_settings")
      .select("is_enabled, phone_id, access_token")
      .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
      .eq("channel", "whatsapp")
      .maybeSingle();

    if (data?.is_enabled && data.access_token && data.phone_id) {
      return { mode: "tenant", phoneId: data.phone_id, accessToken: data.access_token };
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
