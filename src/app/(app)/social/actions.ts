"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { pollIgTags } from "@/lib/ig-ingest";
import { statusAfterAssign, statusAfterIgnore, type SocialStatus } from "@/lib/social-list";

export interface SocialActionResult {
  ok: boolean;
  error?: string;
  stored?: number;
}

/** Admins and Managers run the desk (assign, ignore, refresh). Reps read. */
async function managerGuard() {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { error: "Not authenticated." as const };
  if (!ctx.isAdmin && !ctx.isManager) return { error: "Only admins and managers can do this." as const };
  return { ctx, admin: createAdminClient() };
}

async function loadInteraction(admin: ReturnType<typeof createAdminClient>, tenantId: string, id: string) {
  const { data } = await admin
    .from("ig_interactions")
    .select("id, status, assigned_to")
    .eq("id", id)
    .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
    .maybeSingle();
  return data as { id: string; status: SocialStatus; assigned_to: string | null } | null;
}

/** Assign (or with null, un-assign) an interaction to a member of the same organization. */
export async function assignInteraction(id: string, profileId: string | null): Promise<SocialActionResult> {
  const g = await managerGuard();
  if (g.error) return { ok: false, error: g.error };
  const { ctx, admin } = g;

  const row = await loadInteraction(admin, ctx.tenantId!, id);
  if (!row) return { ok: false, error: "Item not found." };
  if (profileId) {
    const { data: member } = await admin
      .from("profiles")
      .select("id")
      .eq("id", profileId)
      .eq("tenant_id", ctx.tenantId!)
      .maybeSingle();
    if (!member) return { ok: false, error: "That person is not in your organization." };
  }

  const { error } = await admin
    .from("ig_interactions")
    .update({ assigned_to: profileId, status: statusAfterAssign(row.status, profileId) })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId!);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social");
  return { ok: true };
}

/** Ignore an open item, or restore an ignored one. */
export async function setInteractionIgnored(id: string, ignore: boolean): Promise<SocialActionResult> {
  const g = await managerGuard();
  if (g.error) return { ok: false, error: g.error };
  const { ctx, admin } = g;

  const row = await loadInteraction(admin, ctx.tenantId!, id);
  if (!row) return { ok: false, error: "Item not found." };
  const next = statusAfterIgnore(row.status, ignore, row.assigned_to);
  if (!next) return { ok: false, error: ignore ? "Only open items can be ignored." : "Only ignored items can be restored." };

  const { error } = await admin
    .from("ig_interactions")
    .update({ status: next })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId!);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social");
  return { ok: true };
}

/** Pull new posts that tag this organization's Instagram account(s) now, instead of waiting for the daily run. */
export async function refreshTaggedPosts(): Promise<SocialActionResult> {
  const g = await managerGuard();
  if (g.error) return { ok: false, error: g.error };
  const r = await pollIgTags(g.admin, { tenantId: g.ctx.tenantId! });
  revalidatePath("/social");
  if (r.failed && !r.stored) return { ok: false, error: "Instagram didn't answer. Try again in a minute." };
  return { ok: true, stored: r.stored };
}
