"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWhatsAppConfig } from "@/lib/integrations";
import {
  createMetaTemplate,
  deleteMetaTemplate,
  editMetaTemplate,
  listMetaTemplates,
  WhatsAppTemplateApiError,
} from "@/lib/whatsapp-templates";
import { validateTemplate, type TemplateCategory, type TemplateComponent } from "@/lib/whatsapp-template-validator";
import type { WhatsAppTemplate } from "@/lib/types";

const PATH = "/settings/whatsapp-templates";

export interface SaveResult {
  ok: boolean;
  error?: string;
  template?: WhatsAppTemplate;
}

export interface SaveDraftInput {
  id?: string;
  name: string;
  language: string;
  category: TemplateCategory | "";
  components: TemplateComponent[];
}

async function requireAdminWithCloudApi() {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." } as const;
  if (!ctx.isAdmin) return { error: "Only admins can manage WhatsApp templates." } as const;
  if (!ctx.tenantId) return { error: "No organization found." } as const;
  const cfg = await resolveWhatsAppConfig(ctx.tenantId);
  if (cfg.mode !== "tenant_cloud" || !cfg.wabaId || !cfg.accessToken) {
    return {
      error: "Connect the official WhatsApp Cloud API (with a Business Account) in Settings > Integrations first.",
    } as const;
  }
  return { ctx, cfg: cfg as typeof cfg & { wabaId: string; accessToken: string } } as const;
}

/** Check for an existing tenant row with the same name+language (Meta's own uniqueness key). */
async function findDuplicate(tenantId: string, name: string, language: string, excludeId?: string) {
  const admin = createAdminClient();
  let query = admin
    .from("whatsapp_templates")
    .select("id")
    .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
    .eq("name", name)
    .eq("language", language);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

/**
 * Saves the local DRAFT content only — never calls Meta. Meta has no concept of a
 * draft, so this is where a tenant builds and validates before burning a submission
 * attempt (see submitTemplate). Creates a new row or updates an existing DRAFT row.
 */
export async function saveDraftTemplate(input: SaveDraftInput): Promise<SaveResult> {
  const gate = await requireAdminWithCloudApi();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { ctx, cfg } = gate;

  const name = input.name.trim();
  const language = input.language.trim();
  const category = input.category;

  const check = validateTemplate({ name, language, category, components: input.components });
  if (!check.valid) return { ok: false, error: check.errors[0], template: undefined };

  if (await findDuplicate(ctx.tenantId!, name, language, input.id)) {
    return { ok: false, error: `A template named "${name}" already exists for language "${language}".` };
  }

  const admin = createAdminClient();

  if (input.id) {
    const { data: existing } = await admin
      .from("whatsapp_templates")
      .select("status")
      .eq("id", input.id)
      .eq("tenant_id", ctx.tenantId!)
      .maybeSingle();
    if (!existing) return { ok: false, error: "Template not found." };
    if (existing.status !== "DRAFT") {
      return { ok: false, error: "Only draft templates can be edited this way — use Edit to resubmit an already-submitted template." };
    }
    const { data, error } = await admin
      .from("whatsapp_templates")
      .update({ name, language, category, components: input.components })
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true, template: data as WhatsAppTemplate };
  }

  const { data, error } = await admin
    .from("whatsapp_templates")
    .insert({
      tenant_id: ctx.tenantId,
      // owner_id defaults to auth.uid() at the DB level, but that reads the request's
      // JWT claims — the service-role client carries no user JWT, so the default
      // evaluates to null and trips the not-null constraint. Set it explicitly, same
      // reason tenant_id above is explicit rather than left to the stamp trigger.
      owner_id: ctx.userId,
      waba_id: cfg.wabaId,
      name,
      language,
      category,
      components: input.components,
      status: "DRAFT",
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true, template: data as WhatsAppTemplate };
}

/** Submits a DRAFT template to Meta for review. On success the row moves to PENDING. */
export async function submitTemplate(id: string): Promise<SaveResult> {
  const gate = await requireAdminWithCloudApi();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { ctx, cfg } = gate;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("whatsapp_templates")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId!)
    .maybeSingle();
  if (!row) return { ok: false, error: "Template not found." };
  if (row.status !== "DRAFT") return { ok: false, error: "This template has already been submitted." };

  const check = validateTemplate({
    name: row.name,
    language: row.language,
    category: row.category as TemplateCategory,
    components: row.components as TemplateComponent[],
  });
  if (!check.valid) return { ok: false, error: check.errors[0] };

  try {
    const result = await createMetaTemplate(cfg.wabaId, cfg.accessToken, {
      name: row.name,
      language: row.language,
      category: row.category,
      components: row.components as TemplateComponent[],
    });
    const { data, error } = await admin
      .from("whatsapp_templates")
      .update({
        meta_template_id: result.id,
        status: result.status ?? "PENDING",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true, template: data as WhatsAppTemplate };
  } catch (e) {
    const message = e instanceof WhatsAppTemplateApiError ? e.message : "Submission failed.";
    return { ok: false, error: message };
  }
}

export interface EditSubmittedInput {
  id: string;
  category: TemplateCategory | "";
  components: TemplateComponent[];
}

/**
 * Edits an already-submitted (non-DRAFT) template via Meta's edit endpoint. Meta
 * always returns the template to PENDING on a successful edit — name/language cannot
 * change (Meta ties those to the template identity), only category/components.
 */
export async function editSubmittedTemplate(input: EditSubmittedInput): Promise<SaveResult> {
  const gate = await requireAdminWithCloudApi();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { ctx, cfg } = gate;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("whatsapp_templates")
    .select("*")
    .eq("id", input.id)
    .eq("tenant_id", ctx.tenantId!)
    .maybeSingle();
  if (!row) return { ok: false, error: "Template not found." };
  if (row.status === "DRAFT" || !row.meta_template_id) {
    return { ok: false, error: "This template hasn't been submitted yet — use Save draft instead." };
  }

  const check = validateTemplate({
    name: row.name,
    language: row.language,
    category: input.category,
    components: input.components,
  });
  if (!check.valid) return { ok: false, error: check.errors[0] };

  try {
    await editMetaTemplate(row.meta_template_id, cfg.accessToken, {
      category: input.category,
      components: input.components,
    });
    const { data, error } = await admin
      .from("whatsapp_templates")
      .update({
        category: input.category,
        components: input.components,
        status: "PENDING",
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true, template: data as WhatsAppTemplate };
  } catch (e) {
    const message = e instanceof WhatsAppTemplateApiError ? e.message : "Edit failed.";
    return { ok: false, error: message };
  }
}

/** Deletes a template — locally only if it's a DRAFT, otherwise also deletes on Meta. */
export async function deleteTemplate(id: string): Promise<SaveResult> {
  const gate = await requireAdminWithCloudApi();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { ctx, cfg } = gate;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("whatsapp_templates")
    .select("id, name, status")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId!)
    .maybeSingle();
  if (!row) return { ok: false, error: "Template not found." };

  if (row.status !== "DRAFT") {
    try {
      await deleteMetaTemplate(cfg.wabaId, cfg.accessToken, row.name);
    } catch (e) {
      const message = e instanceof WhatsAppTemplateApiError ? e.message : "Delete failed.";
      return { ok: false, error: message };
    }
  }

  const { error } = await admin.from("whatsapp_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Full two-way reconcile against Meta's live template list — catches drift beyond
 * what the webhook delivers (events missed while the webhook was misconfigured), AND
 * brings in templates that exist on the WABA but were never created through this app
 * (e.g. Meta's own "hello_world" sample, or a client's pre-existing templates when
 * they're first onboarded — sync is how those become visible here at all).
 *
 *   - on Meta, no local row      → INSERT (upsert on tenant_id+name+language)
 *   - on Meta AND local          → UPDATE status/category/components/quality/rejection
 *   - local (submitted) but gone from Meta → mark orphaned_at, never delete — a
 *     client's history shouldn't silently vanish because someone deleted it in
 *     WhatsApp Manager. DRAFT rows are excluded: they were never on Meta to begin with.
 */
export async function syncTemplates(): Promise<SaveResult> {
  const gate = await requireAdminWithCloudApi();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { ctx, cfg } = gate;

  try {
    const remote = await listMetaTemplates(cfg.wabaId, cfg.accessToken);
    const admin = createAdminClient();
    const remoteKeys = new Set(remote.map((t) => `${t.name} ${t.language}`));

    for (const t of remote) {
      // Meta returns the literal string "NONE" for a non-rejected template, not
      // null/absent — normalize it, else every approved template shows a "NONE"
      // rejection reason.
      const rejectionReason = t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null;
      const quality = typeof t.quality_score === "string" ? t.quality_score : (t.quality_score?.score ?? null);

      const { error } = await admin.from("whatsapp_templates").upsert(
        {
          tenant_id: ctx.tenantId,
          // Same not-null-default-auth.uid()-under-service-role trap as the draft
          // insert — must be set explicitly on the INSERT branch of this upsert.
          owner_id: ctx.userId,
          waba_id: cfg.wabaId,
          meta_template_id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          components: t.components,
          status: t.status,
          rejection_reason: rejectionReason,
          quality_score: quality,
          reviewed_at: new Date().toISOString(),
          orphaned_at: null,
        },
        { onConflict: "tenant_id,name,language" },
      );
      if (error) {
        console.error("[WA Templates] sync upsert failed:", error.message, { name: t.name, language: t.language });
      }
    }

    const { data: localRows } = await admin
      .from("whatsapp_templates")
      .select("id, name, language, orphaned_at")
      .eq("tenant_id", ctx.tenantId!)
      .eq("waba_id", cfg.wabaId)
      .not("meta_template_id", "is", null);

    for (const row of localRows ?? []) {
      const key = `${row.name} ${row.language}`;
      if (!remoteKeys.has(key) && !row.orphaned_at) {
        await admin.from("whatsapp_templates").update({ orphaned_at: new Date().toISOString() }).eq("id", row.id);
      }
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    const message = e instanceof WhatsAppTemplateApiError ? e.message : "Sync failed.";
    return { ok: false, error: message };
  }
}

