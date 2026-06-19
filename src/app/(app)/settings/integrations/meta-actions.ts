"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribePage, fetchPageForms, fetchFormLeads, mapLead } from "@/lib/meta";

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

export interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  error?: string;
}

/** Pull all historical leads from Meta for a connected Page into the CRM. */
export async function importHistoricalLeads(pageId: string): Promise<ImportResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, imported: 0, skipped: 0, error: g.error };

  const admin = createAdminClient();

  const { data: page } = await admin
    .from("meta_lead_pages")
    .select("access_token, default_owner_id")
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", pageId)
    .maybeSingle();

  if (!page?.access_token) {
    return { ok: false, imported: 0, skipped: 0, error: "Page not found or not connected." };
  }

  const token = page.access_token as string;
  const defaultOwnerId = (page.default_owner_id as string | null) ?? null;
  let imported = 0;
  let skipped = 0;

  try {
    const forms = await fetchPageForms(pageId, token);

    for (const form of forms) {
      const rawLeads = await fetchFormLeads(form.id, token);

      for (const raw of rawLeads) {
        const { data: existing } = await admin
          .from("meta_lead_events")
          .select("id")
          .eq("leadgen_id", raw.id)
          .maybeSingle();

        if (existing) { skipped++; continue; }

        const mapped = mapLead({
          field_data: raw.field_data,
          platform: raw.platform,
          ad_id: raw.ad_id,
          form_id: raw.form_id ?? form.id,
          created_time: raw.created_time,
        });

        const customFields: Record<string, string> = {
          ...mapped.answers,
          fb_leadgen_id: raw.id,
          fb_form_id: raw.form_id ?? form.id,
          fb_page_id: pageId,
          ...(raw.ad_id ? { fb_ad_id: raw.ad_id } : {}),
          ...(raw.platform ? { fb_platform: raw.platform } : {}),
        };

        const { data: newLead } = await admin
          .from("leads")
          .insert({
            tenant_id: g.ctx.tenantId,
            first_name: mapped.first_name,
            last_name: mapped.last_name,
            email: mapped.email,
            phone: mapped.phone,
            company: mapped.company,
            source: mapped.source,
            status: "new",
            owner_id: defaultOwnerId,
            custom_fields: customFields,
          })
          .select("id")
          .single();

        if (!newLead) continue;

        await admin.from("meta_lead_events").insert({
          tenant_id: g.ctx.tenantId,
          leadgen_id: raw.id,
          page_id: pageId,
          form_id: raw.form_id ?? form.id,
          lead_id: newLead.id,
          status: "created",
        });

        imported++;
      }
    }

    if (imported > 0) revalidatePath("/leads");
    return { ok: true, imported, skipped };
  } catch (e) {
    return { ok: false, imported, skipped, error: e instanceof Error ? e.message : "Import failed." };
  }
}
