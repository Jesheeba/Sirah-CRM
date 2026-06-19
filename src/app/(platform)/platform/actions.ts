"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";

export interface ProvisionInput {
  orgName: string;
  ownerEmail: string;
  currency?: string;
  timezone?: string;
  locale?: string;
}

export interface ProvisionResult {
  ok: boolean;
  tenantId?: string;
  ownerEmail?: string;
  tempPassword?: string;
  error?: string;
}

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 14; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${s}!9`; // guarantees length + symbol/digit complexity
}

/**
 * Provisions a new tenant with its first Admin user.
 *  1. Creates the auth user via the service role (Auth admin op — no SQL equivalent).
 *  2. Builds the org via the SECURITY DEFINER `admin_provision_tenant` RPC (audited).
 * The platform admin's session authorizes the RPC; the new user gets a one-time
 * password returned here to share. Rolls the user back if provisioning fails.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const ctx = await getUserContext();
  if (!ctx?.isPlatformAdmin) return { ok: false, error: "Not authorized." };

  const orgName = input.orgName?.trim();
  const ownerEmail = input.ownerEmail?.trim().toLowerCase();
  if (!orgName) return { ok: false, error: "Organization name is required." };
  if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return { ok: false, error: "A valid owner email is required." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Service role not configured (SUPABASE_SERVICE_ROLE_KEY)." };
  }

  // 1) Create the owner auth user.
  const password = tempPassword();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  if (cErr || !created?.user) {
    return { ok: false, error: cErr?.message ?? "Could not create the owner user." };
  }

  // 2) Provision the org for that user (audited RPC, gated by is_platform_admin()).
  const supabase = await createClient();
  const { data: tenantId, error: pErr } = await supabase.rpc("admin_provision_tenant", {
    p_owner: created.user.id,
    p_name: orgName,
    p_currency: input.currency?.trim() || "INR",
    p_timezone: input.timezone?.trim() || "Asia/Kolkata",
    p_locale: input.locale?.trim() || "en",
  });

  if (pErr) {
    // Roll back the orphaned auth user so the email can be retried.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: pErr.message };
  }

  return { ok: true, tenantId: tenantId as string, ownerEmail, tempPassword: password };
}
