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

export interface ResetPasswordResult {
  ok: boolean;
  email?: string;
  tempPassword?: string;
  error?: string;
}

/**
 * Resets a tenant admin's password to a new one-time temp password. `admin_resolve_
 * tenant_admin` scopes the lookup to Admin-role users on that exact tenant, so this
 * can't be used to reset an arbitrary account elsewhere just by passing any email.
 */
export async function resetTenantPassword(input: { tenantId: string; email: string }): Promise<ResetPasswordResult> {
  const ctx = await getUserContext();
  if (!ctx?.isPlatformAdmin) return { ok: false, error: "Not authorized." };

  const email = input.email?.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  const supabase = await createClient();
  const { data: userId, error: rErr } = await supabase.rpc("admin_resolve_tenant_admin", {
    p_tenant: input.tenantId,
    p_email: email,
  });
  if (rErr || !userId) return { ok: false, error: rErr?.message ?? "Could not find that admin." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Service role not configured (SUPABASE_SERVICE_ROLE_KEY)." };
  }

  const password = tempPassword();
  const { error: uErr } = await admin.auth.admin.updateUserById(userId as string, { password });
  if (uErr) return { ok: false, error: uErr.message };

  // Best-effort audit entry — the password reset itself already succeeded above.
  await supabase.rpc("admin_log_password_reset", { p_tenant: input.tenantId, p_email: email });

  return { ok: true, email, tempPassword: password };
}
