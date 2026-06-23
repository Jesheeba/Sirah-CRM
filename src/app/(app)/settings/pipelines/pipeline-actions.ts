"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { Pipeline, Stage } from "@/lib/types";

const PATH = "/settings/pipelines";

async function adminCtx() {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return null;
  return { admin: createAdminClient(), tenantId: ctx.tenantId! };
}

// ── Pipelines ────────────────────────────────────────────────────────────────

export async function createPipeline(
  name: string,
): Promise<{ ok: boolean; error?: string; pipeline?: Pipeline; stages?: Stage[] }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { data: pl, error: plErr } = await ctx.admin
    .from("pipelines")
    .insert({ tenant_id: ctx.tenantId, name: name.trim(), is_default: false, display_order: 0 })
    .select("*")
    .single();
  if (plErr) return { ok: false, error: plErr.message };

  const defaultStages = [
    { tenant_id: ctx.tenantId, pipeline_id: pl.id, name: "New", display_order: 0, probability: 10 },
    { tenant_id: ctx.tenantId, pipeline_id: pl.id, name: "Won", display_order: 1, probability: 100, is_won: true },
    { tenant_id: ctx.tenantId, pipeline_id: pl.id, name: "Lost", display_order: 2, probability: 0, is_lost: true },
  ];
  const { data: stages } = await ctx.admin.from("stages").insert(defaultStages).select("*");

  revalidatePath(PATH);
  return { ok: true, pipeline: pl as Pipeline, stages: (stages ?? []) as Stage[] };
}

export async function updatePipeline(
  id: string,
  updates: { name?: string },
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { error } = await ctx.admin
    .from("pipelines")
    .update({ name: updates.name?.trim() })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function setDefaultPipeline(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  // Unset all, then set this one
  await ctx.admin
    .from("pipelines")
    .update({ is_default: false })
    .eq("tenant_id", ctx.tenantId);

  const { error } = await ctx.admin
    .from("pipelines")
    .update({ is_default: true })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deletePipeline(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  // Block if this is the default pipeline
  const { data: pl } = await ctx.admin
    .from("pipelines")
    .select("is_default")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .single();
  if (pl?.is_default) return { ok: false, error: "Cannot delete the default pipeline. Set another as default first." };

  // Block if any open deals exist in this pipeline
  const { count } = await ctx.admin
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", id)
    .eq("status", "open");
  if ((count ?? 0) > 0)
    return { ok: false, error: `Cannot delete — ${count} open deal(s) are in this pipeline. Move or close them first.` };

  const { error } = await ctx.admin
    .from("pipelines")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

// ── Stages ───────────────────────────────────────────────────────────────────

export async function createStage(
  pipelineId: string,
  data: { name: string; probability: number; is_won: boolean; is_lost: boolean },
): Promise<{ ok: boolean; error?: string; stage?: Stage }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  // Determine next display_order
  const { data: existing } = await ctx.admin
    .from("stages")
    .select("display_order")
    .eq("pipeline_id", pipelineId)
    .order("display_order", { ascending: false })
    .limit(1);
  const nextOrder = ((existing?.[0] as { display_order: number } | undefined)?.display_order ?? -1) + 1;

  const { data: stage, error } = await ctx.admin
    .from("stages")
    .insert({
      tenant_id: ctx.tenantId,
      pipeline_id: pipelineId,
      name: data.name.trim(),
      probability: data.probability,
      is_won: data.is_won,
      is_lost: data.is_lost,
      display_order: nextOrder,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, stage: stage as Stage };
}

export async function updateStage(
  id: string,
  data: { name?: string; probability?: number; is_won?: boolean; is_lost?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.probability !== undefined) updates.probability = data.probability;
  if (data.is_won !== undefined) updates.is_won = data.is_won;
  if (data.is_lost !== undefined) updates.is_lost = data.is_lost;

  const { error } = await ctx.admin
    .from("stages")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteStage(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { count } = await ctx.admin
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", id);
  if ((count ?? 0) > 0)
    return { ok: false, error: `Cannot delete — ${count} deal(s) are in this stage. Move them first.` };

  const { error } = await ctx.admin
    .from("stages")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function reorderStages(
  pipelineId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const updates = orderedIds.map((id, i) =>
    ctx.admin
      .from("stages")
      .update({ display_order: i })
      .eq("id", id)
      .eq("pipeline_id", pipelineId)
      .eq("tenant_id", ctx.tenantId),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath(PATH);
  return { ok: true };
}
