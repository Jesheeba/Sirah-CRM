"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribePage } from "@/lib/meta";

export interface MetaActionResult {
  ok: boolean;
  error?: string;
}

/** Admin + tenant guard shared by every action below. */
async function requireAdminTenant() {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." as const };
  if (!ctx.isAdmin) return { error: "Only admins can manage Meta Lead Ads." as const };
  if (!ctx.tenantId) return { error: "No organization found." as const };
  return { ctx };
}

/** Enable/disable lead ingestion for a connected Page. */
export async function setMetaPageEnabled(
  pageId: string,
  enabled: boolean,
): Promise<MetaActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_lead_pages")
    .update({ is_enabled: enabled })
    .eq("tenant_id", g.ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("page_id", pageId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Route a Page's incoming leads to a specific user (or unassigned when null). */
export async function setMetaPageOwner(
  pageId: string,
  ownerId: string | null,
): Promise<MetaActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_lead_pages")
    .update({ default_owner_id: ownerId })
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", pageId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Unsubscribe the Page from the webhook (best effort) and remove it. */
export async function disconnectMetaPage(pageId: string): Promise<MetaActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { data: page } = await admin
    .from("meta_lead_pages")
    .select("access_token")
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", pageId)
    .maybeSingle();

  if (page?.access_token) {
    try {
      await unsubscribePage(pageId, page.access_token as string);
    } catch {
      // best effort — still remove the local record
    }
  }

  const { error } = await admin
    .from("meta_lead_pages")
    .delete()
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", pageId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}
