"use server";

import { mergeBlocklist, mergeDeskBranding, type DeskStatus } from "@/lib/social-desk-setup";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { FEED_MAX_ACTIVE_KEYS, feedKeyPrefix, generateFeedToken, hashFeedKey } from "@/lib/lead-feed";
import { CHANNEL_PATTERN, generateWebhookSecret } from "@/lib/lead-webhook";

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

/** A feed key as listed in the UI. The secret itself is never part of this. */
export interface LeadFeedKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  last_used_via: "header" | "url" | null;
  revoked_at: string | null;
}

export interface CreateFeedKeyResult {
  ok: boolean;
  /** The full key. Returned exactly once — only its hash is stored. */
  key?: string;
  info?: LeadFeedKeyInfo;
  error?: string;
}

const KEY_COLUMNS = "id, name, key_prefix, created_at, last_used_at, last_used_via, revoked_at";

async function platformAdminClient() {
  const ctx = await getUserContext();
  if (!ctx?.isPlatformAdmin) return { error: "Not authorized." as const };
  try {
    return { admin: createAdminClient() };
  } catch {
    return { error: "Service role not configured (SUPABASE_SERVICE_ROLE_KEY)." as const };
  }
}

/**
 * Creates a named API key for a tenant's Meta-leads pull feed. The plaintext key is
 * returned once and never stored — only its SHA-256 hash is — so it can't be shown again.
 */
export async function createLeadFeedKey(input: { tenantId: string; name: string }): Promise<CreateFeedKeyResult> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };

  const name = input.name?.trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give the key a name, e.g. the system that will use it." };

  const { count } = await g.admin
    .from("lead_feed_keys")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .is("revoked_at", null);
  if ((count ?? 0) >= FEED_MAX_ACTIVE_KEYS) {
    return { ok: false, error: `This client already has ${FEED_MAX_ACTIVE_KEYS} active keys. Revoke one first.` };
  }

  const key = generateFeedToken();
  const { data, error } = await g.admin
    .from("lead_feed_keys")
    .insert({
      tenant_id: input.tenantId,
      name,
      key_prefix: feedKeyPrefix(key),
      key_hash: hashFeedKey(key),
    })
    .select(KEY_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the key." };
  return { ok: true, key, info: data as LeadFeedKeyInfo };
}

/** Revokes one key immediately. Other keys for the tenant keep working. */
export async function revokeLeadFeedKey(input: { tenantId: string; keyId: string }): Promise<{ ok: boolean; error?: string }> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };

  const { error } = await g.admin
    .from("lead_feed_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.keyId)
    .eq("tenant_id", input.tenantId) // a key id from another tenant can't be revoked here
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** An inbound webhook channel as listed in the UI. The signing secret is never part of this. */
export interface WebhookChannelInfo {
  id: string;
  channel: string;
  name: string;
  is_enabled: boolean;
  created_at: string;
  secret_rotated_at: string;
  last_used_at: string | null;
}

export interface WebhookDeliveryInfo {
  id: string;
  channel_id: string;
  request_id: string;
  http_status: number;
  error_code: string | null;
  received: number;
  created: number;
  updated: number;
  failed: number;
  created_at: string;
}

export interface WebhookChannelResult {
  ok: boolean;
  /** The signing secret. Returned once, at creation or rotation — shown to the Super Admin to hand over. */
  secret?: string;
  info?: WebhookChannelInfo;
  error?: string;
}

const CHANNEL_COLUMNS = "id, channel, name, is_enabled, created_at, secret_rotated_at, last_used_at";

/** Creates a signed-webhook channel for a tenant. The channel name is the URL path segment. */
export async function createWebhookChannel(input: {
  tenantId: string;
  channel: string;
  name: string;
}): Promise<WebhookChannelResult> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };

  const channel = input.channel?.trim().toLowerCase();
  const name = input.name?.trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give the channel a name, e.g. the sender's system." };
  if (!channel || !CHANNEL_PATTERN.test(channel)) {
    return { ok: false, error: "Channel must be 2–39 characters: lower-case letters, digits, - or _ (e.g. metarelay)." };
  }

  const secret = generateWebhookSecret();
  const { data, error } = await g.admin
    .from("lead_webhook_channels")
    .insert({ tenant_id: input.tenantId, channel, name, secret })
    .select(CHANNEL_COLUMNS)
    .single();
  if (error?.code === "23505") return { ok: false, error: `The channel “${channel}” is already taken. Choose another.` };
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the channel." };
  return { ok: true, secret, info: data as WebhookChannelInfo };
}

/** Issues a new signing secret. The old one stops verifying immediately. */
export async function rotateWebhookSecret(input: { tenantId: string; channelId: string }): Promise<WebhookChannelResult> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };

  const secret = generateWebhookSecret();
  const { data, error } = await g.admin
    .from("lead_webhook_channels")
    .update({ secret, secret_rotated_at: new Date().toISOString() })
    .eq("id", input.channelId)
    .eq("tenant_id", input.tenantId)
    .select(CHANNEL_COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Channel not found." };
  return { ok: true, secret, info: data as WebhookChannelInfo };
}

/** Pause or resume a channel. A paused channel answers 401 unknown_channel. */
export async function setWebhookChannelEnabled(input: {
  tenantId: string;
  channelId: string;
  enabled: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };
  const { error } = await g.admin
    .from("lead_webhook_channels")
    .update({ is_enabled: input.enabled })
    .eq("id", input.channelId)
    .eq("tenant_id", input.tenantId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Deletes a channel and its delivery log. Leads it already created are kept. */
export async function deleteWebhookChannel(input: { tenantId: string; channelId: string }): Promise<{ ok: boolean; error?: string }> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };
  const { error } = await g.admin
    .from("lead_webhook_channels")
    .delete()
    .eq("id", input.channelId)
    .eq("tenant_id", input.tenantId);
  return error ? { ok: false, error: error.message } : { ok: true };
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

export interface SocialDeskResult {
  ok: boolean;
  error?: string;
  status?: DeskStatus;
}

/** Current social-desk setup of a tenant, for the Super Admin tenant page (platform admins only). */
export async function loadSocialDeskStatus(tenantId: string): Promise<DeskStatus> {
  const g = await platformAdminClient();
  if (g.error) return { socialEnabled: false, leadsLabel: null, hasSettings: false, replyMode: null, instagramAccounts: 0 };
  const { admin } = g;
  const [{ data: b }, { data: s }, { data: accs }] = await Promise.all([
    admin.from("organization_branding").select("module_labels, module_visibility").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("ig_desk_settings").select("reply_mode").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("ig_accounts").select("id").eq("tenant_id", tenantId).neq("status", "revoked"),
  ]);
  const vis = ((b as { module_visibility?: Record<string, unknown> } | null)?.module_visibility ?? {}) as Record<string, unknown>;
  const labels = ((b as { module_labels?: Record<string, unknown> } | null)?.module_labels ?? {}) as Record<string, unknown>;
  return {
    socialEnabled: vis.social === true,
    leadsLabel: typeof labels.leads === "string" ? labels.leads : null,
    hasSettings: Boolean(s),
    replyMode: (s as { reply_mode?: string } | null)?.reply_mode ?? null,
    instagramAccounts: ((accs ?? []) as unknown[]).length,
  };
}

/**
 * One-step "social desk" setup for a tenant (MLA desk F7): turns on the Social module, optionally
 * renames Leads to "Issues", and creates reply settings (approval required, no self-approval) with a
 * starter blocklist. Safe to run again: it merges, never overwrites the tenant's own choices.
 * Roles: Admin = everything, Manager = approver, Sales Rep = drafter (existing role model).
 */
export async function setupSocialDesk(input: { tenantId: string; renameLeads: boolean }): Promise<SocialDeskResult> {
  const g = await platformAdminClient();
  if (g.error) return { ok: false, error: g.error };
  const { admin } = g;

  const { data: tenant } = await admin.from("tenants").select("id").eq("id", input.tenantId).maybeSingle();
  if (!tenant) return { ok: false, error: "Tenant not found." };

  const { data: b } = await admin
    .from("organization_branding")
    .select("module_labels, module_visibility")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const merged = mergeDeskBranding(b as { module_labels?: Record<string, unknown>; module_visibility?: Record<string, unknown> } | null, input.renameLeads);
  const { error: bErr } = await admin
    .from("organization_branding")
    .upsert({ tenant_id: input.tenantId, ...merged }, { onConflict: "tenant_id" });
  if (bErr) return { ok: false, error: bErr.message };

  const { data: s } = await admin
    .from("ig_desk_settings")
    .select("reply_mode, allow_self_approve, blocklist")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const cur = s as { reply_mode?: string; allow_self_approve?: boolean; blocklist?: string[] } | null;
  const { error: sErr } = await admin.from("ig_desk_settings").upsert(
    {
      tenant_id: input.tenantId,
      reply_mode: cur?.reply_mode ?? "human_approval",
      allow_self_approve: cur?.allow_self_approve ?? false,
      blocklist: mergeBlocklist(cur?.blocklist),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (sErr) return { ok: false, error: sErr.message };

  return { ok: true, status: await loadSocialDeskStatus(input.tenantId) };
}
