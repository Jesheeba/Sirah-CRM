"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribePage, fetchPageForms, fetchFormLeads, fetchAdName, mapLead } from "@/lib/meta";
import { distinctAdIds, mergedCustomFields, type BackfillLeadRow } from "@/lib/ad-name-backfill";

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

    // Collect every lead first (de-duplicated by leadgen id), then work in batches: a page
    // with hundreds of leads must not cost two round-trips per lead or the request times out.
    const incoming = new Map<string, { raw: Awaited<ReturnType<typeof fetchFormLeads>>[number]; formId: string }>();
    const formNames = new Map(forms.map((f) => [f.id, f.name]));
    for (const form of forms) {
      for (const raw of await fetchFormLeads(form.id, token)) {
        incoming.set(raw.id, { raw, formId: raw.form_id ?? form.id });
      }
    }

    // Which of them did we already import (or receive via the webhook)?
    const all = [...incoming.values()];
    const known = new Set<string>();
    for (let i = 0; i < all.length; i += 200) {
      const { data } = await admin
        .from("meta_lead_events")
        .select("leadgen_id")
        .in("leadgen_id", all.slice(i, i + 200).map((x) => x.raw.id));
      for (const r of data ?? []) known.add(r.leadgen_id as string);
    }
    const fresh = all.filter((x) => !known.has(x.raw.id));
    skipped = all.length - fresh.length;

    // One Graph call per distinct ad, not per lead (many leads share an ad).
    const adNames = new Map<string, string>();
    // Meta returns ad_name on some lead nodes; that needs no ads permission, so
    // take it first and only ask Graph about the ads still unnamed.
    for (const { raw } of fresh) {
      if (raw.ad_id && raw.ad_name?.trim()) adNames.set(raw.ad_id, raw.ad_name.trim());
    }
    for (const adId of new Set(fresh.map((x) => x.raw.ad_id).filter((id): id is string => Boolean(id)))) {
      if (adNames.has(adId)) continue;
      const name = await fetchAdName(adId, token);
      if (name) adNames.set(adId, name);
    }

    for (let i = 0; i < fresh.length; i += 100) {
      const batch = fresh.slice(i, i + 100);

      const rows = batch.map(({ raw, formId }) => {
        const mapped = mapLead({
          field_data: raw.field_data,
          platform: raw.platform,
          ad_id: raw.ad_id,
          form_id: formId,
          created_time: raw.created_time,
        });
        return {
          tenant_id: g.ctx.tenantId,
          first_name: mapped.first_name,
          last_name: mapped.last_name,
          email: mapped.email,
          phone: mapped.phone,
          company: mapped.company,
          source: mapped.source,
          status: "new",
          owner_id: defaultOwnerId,
          custom_fields: {
            ...mapped.answers,
            fb_leadgen_id: raw.id,
            fb_form_id: formId,
            ...(formNames.get(formId) ? { fb_form_name: formNames.get(formId)! } : {}),
            fb_page_id: pageId,
            ...(raw.ad_id ? { fb_ad_id: raw.ad_id } : {}),
            ...(raw.ad_id && adNames.get(raw.ad_id) ? { fb_ad_name: adNames.get(raw.ad_id)! } : {}),
            ...(raw.platform ? { fb_platform: raw.platform } : {}),
            // Original submission time — created_at would otherwise show the import date.
            ...(raw.created_time ? { fb_created_time: raw.created_time } : {}),
          } as Record<string, string>,
        };
      });

      const { data: created, error: leadErr } = await admin
        .from("leads")
        .insert(rows)
        .select("id, custom_fields");
      if (leadErr) throw new Error(`Saving leads failed after ${imported} imported: ${leadErr.message}`);

      const leadIdByLeadgen = new Map<string, string>(
        (created ?? []).map((l) => [(l.custom_fields as Record<string, string>).fb_leadgen_id, l.id as string]),
      );
      const { error: evErr } = await admin.from("meta_lead_events").insert(
        batch.map(({ raw, formId }) => ({
          tenant_id: g.ctx.tenantId,
          leadgen_id: raw.id,
          page_id: pageId,
          form_id: formId,
          lead_id: leadIdByLeadgen.get(raw.id) ?? null,
          status: "created",
        })),
      );
      if (evErr) throw new Error(`Recording imported leads failed: ${evErr.message}`);

      imported += created?.length ?? 0;
    }

    if (imported > 0) revalidatePath("/leads");
    return { ok: true, imported, skipped };
  } catch (e) {
    return { ok: false, imported, skipped, error: e instanceof Error ? e.message : "Import failed." };
  }
}

export interface BackfillResult {
  ok: boolean;
  /** Leads that gained an ad name. */
  updated: number;
  /** Distinct ads Meta told us the name of. */
  adsResolved: number;
  /** Distinct ads Meta refused — usually the Page token lacking ads-level read access. */
  adsRefused: number;
  error?: string;
}

/**
 * Fill in `fb_ad_name` on this Page's existing leads that have an ad id but no ad name
 * (leads stored before ad names were captured). Merge-only: never overwrites a name and
 * never drops another custom field.
 *
 * `adsRefused` doubles as a diagnostic — all refused means the Page token has no
 * ads-level read access, so no amount of re-running will help until `ads_read` is granted.
 */
export async function backfillAdNames(pageId: string): Promise<BackfillResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, updated: 0, adsResolved: 0, adsRefused: 0, error: g.error };

  const admin = createAdminClient();

  const { data: page } = await admin
    .from("meta_lead_pages")
    .select("access_token")
    .eq("tenant_id", g.ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("page_id", pageId)
    .maybeSingle();
  if (!page?.access_token) {
    return { ok: false, updated: 0, adsResolved: 0, adsRefused: 0, error: "Page not found or not connected." };
  }
  const token = page.access_token as string;

  try {
    // Only this page's leads: a tenant may connect several Pages, and one Page's token
    // must not be used to resolve another Page's ads.
    const { data, error } = await admin
      .from("leads")
      .select("id, custom_fields")
      .eq("tenant_id", g.ctx.tenantId)
      .is("deleted_at", null)
      .eq("custom_fields->>fb_page_id", pageId)
      .not("custom_fields->>fb_ad_id", "is", null);
    // The "already has a name" filter is applied in code (distinctAdIds / mergedCustomFields)
    // rather than as a `.is(...->>fb_ad_name, null)` clause: both are correct in Postgres, but
    // the code path is unit-tested and cannot silently match nothing if the operator changes.
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as BackfillLeadRow[];
    const adIds = distinctAdIds(rows);
    if (adIds.length === 0) {
      return { ok: true, updated: 0, adsResolved: 0, adsRefused: 0 };
    }

    // One Graph call per distinct ad, not per lead.
    const names = new Map<string, string>();
    let adsRefused = 0;
    for (const adId of adIds) {
      const name = await fetchAdName(adId, token);
      if (name) names.set(adId, name);
      else adsRefused++;
    }

    let updated = 0;
    for (const row of rows) {
      const merged = mergedCustomFields(row, names);
      if (!merged) continue;
      const { error: upErr } = await admin
        .from("leads")
        .update({ custom_fields: merged })
        .eq("tenant_id", g.ctx.tenantId)
        .eq("id", row.id);
      if (upErr) throw new Error(`Updating a lead failed after ${updated} updated: ${upErr.message}`);
      updated++;
    }

    if (updated > 0) revalidatePath("/leads");
    return { ok: true, updated, adsResolved: names.size, adsRefused };
  } catch (e) {
    return {
      ok: false, updated: 0, adsResolved: 0, adsRefused: 0,
      error: e instanceof Error ? e.message : "Backfill failed.",
    };
  }
}
