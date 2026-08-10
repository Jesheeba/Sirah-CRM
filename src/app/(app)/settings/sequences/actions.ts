"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { Sequence, SequenceStep, SequenceChannel, SequenceStepContent } from "@/lib/types";

const PATH = "/settings/sequences";

async function adminCtx() {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return null;
  return { admin: createAdminClient(), tenantId: ctx.tenantId! };
}

// ── Sequences ────────────────────────────────────────────────────────────────

export async function createSequence(
  name: string,
): Promise<{ ok: boolean; error?: string; sequence?: Sequence }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { data, error } = await ctx.admin
    .from("sequences")
    .insert({ tenant_id: ctx.tenantId, name: name.trim() })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, sequence: data as Sequence };
}

export async function updateSequence(
  id: string,
  updates: { name?: string; description?: string | null; is_active?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;

  const { error } = await ctx.admin
    .from("sequences")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteSequence(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { count } = await ctx.admin
    .from("sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", id)
    .eq("status", "active");
  if ((count ?? 0) > 0)
    return { ok: false, error: `Cannot delete — ${count} lead(s) are actively enrolled. Stop them first.` };

  const { error } = await ctx.admin.from("sequences").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

// ── Steps ────────────────────────────────────────────────────────────────────

export async function createStep(
  sequenceId: string,
  data: { channel: SequenceChannel; delay_hours: number; content: SequenceStepContent },
): Promise<{ ok: boolean; error?: string; step?: SequenceStep }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { data: existing } = await ctx.admin
    .from("sequence_steps")
    .select("step_order")
    .eq("sequence_id", sequenceId)
    .order("step_order", { ascending: false })
    .limit(1);
  const nextOrder = ((existing?.[0] as { step_order: number } | undefined)?.step_order ?? -1) + 1;

  const { data: step, error } = await ctx.admin
    .from("sequence_steps")
    .insert({
      tenant_id: ctx.tenantId,
      sequence_id: sequenceId,
      step_order: nextOrder,
      channel: data.channel,
      delay_hours: data.delay_hours,
      content: data.content,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, step: step as SequenceStep };
}

export async function updateStep(
  id: string,
  data: { delay_hours?: number; content?: SequenceStepContent },
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const payload: Record<string, unknown> = {};
  if (data.delay_hours !== undefined) payload.delay_hours = data.delay_hours;
  if (data.content !== undefined) payload.content = data.content;

  const { error } = await ctx.admin.from("sequence_steps").update(payload).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteStep(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { error } = await ctx.admin.from("sequence_steps").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Renumbers a sequence's steps to match `orderedIds`. Two passes to avoid transiently
 * colliding with the (sequence_id, step_order) unique constraint: negative placeholders
 * first, then the real 0..n-1 values.
 */
export async function reorderSteps(
  sequenceId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const placeholders = orderedIds.map((id, i) =>
    ctx.admin.from("sequence_steps").update({ step_order: -(i + 1) }).eq("id", id).eq("sequence_id", sequenceId),
  );
  const r1 = await Promise.all(placeholders);
  const f1 = r1.find((r) => r.error);
  if (f1?.error) return { ok: false, error: f1.error.message };

  const finals = orderedIds.map((id, i) =>
    ctx.admin.from("sequence_steps").update({ step_order: i }).eq("id", id).eq("sequence_id", sequenceId),
  );
  const r2 = await Promise.all(finals);
  const f2 = r2.find((r) => r.error);
  if (f2?.error) return { ok: false, error: f2.error.message };

  revalidatePath(PATH);
  return { ok: true };
}
