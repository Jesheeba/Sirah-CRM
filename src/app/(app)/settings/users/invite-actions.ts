"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLES = ["Admin", "Manager", "Sales Rep"] as const;
type InviteRole = (typeof ROLES)[number];

export async function sendInvite(
  email: string,
  roleName: InviteRole,
): Promise<{ ok: boolean; link?: string; error?: string }> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Admins only." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();

  // Resolve role_id within this tenant
  const { data: roleRow, error: roleErr } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("name", roleName)
    .maybeSingle();

  if (roleErr || !roleRow) return { ok: false, error: "Role not found." };

  // Check no active member already has this email
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("email", email)
    .maybeSingle();

  if (existing) return { ok: false, error: "A member with that email already exists." };

  // Upsert: if a pending invite exists for this email, replace it
  const token = crypto.randomUUID();
  const { error: insertErr } = await admin.from("invitations").upsert(
    {
      tenant_id: ctx.tenantId,
      email: email.toLowerCase().trim(),
      role_id: roleRow.id,
      token,
      status: "pending",
      invited_by: ctx.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "token" },
  );

  if (insertErr) return { ok: false, error: insertErr.message };

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return { ok: true, link: `${base}/join?token=${token}` };
}

export async function cancelInvite(
  invitationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Admins only." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("invitations")
    .update({ status: "cancelled" })
    .eq("id", invitationId)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/users");
  return { ok: true };
}
