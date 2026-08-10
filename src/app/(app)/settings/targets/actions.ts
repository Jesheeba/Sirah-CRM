"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { SalesTarget, TargetMetric } from "@/lib/types";

const PATH = "/settings/targets";

async function adminCtx() {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return null;
  return { admin: createAdminClient(), tenantId: ctx.tenantId! };
}

export async function createTarget(data: {
  user_id: string | null;
  period: string;
  metric: TargetMetric;
  target_value: number;
}): Promise<{ ok: boolean; error?: string; target?: SalesTarget }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };
  if (!/^\d{4}-\d{2}$/.test(data.period)) return { ok: false, error: "Pick a month." };
  if (!(data.target_value > 0)) return { ok: false, error: "Target must be greater than zero." };

  const { data: target, error } = await ctx.admin
    .from("sales_targets")
    .insert({
      tenant_id: ctx.tenantId,
      user_id: data.user_id,
      period: data.period,
      metric: data.metric,
      target_value: data.target_value,
    })
    .select("*")
    .single();
  if (error) {
    const message = error.message.includes("duplicate key")
      ? "A target for this rep/team, month, and metric already exists — edit or delete it instead."
      : error.message;
    return { ok: false, error: message };
  }

  revalidatePath(PATH);
  return { ok: true, target: target as SalesTarget };
}

export async function updateTarget(
  id: string,
  target_value: number,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };
  if (!(target_value > 0)) return { ok: false, error: "Target must be greater than zero." };

  const { error } = await ctx.admin
    .from("sales_targets")
    .update({ target_value })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteTarget(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { error } = await ctx.admin.from("sales_targets").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
