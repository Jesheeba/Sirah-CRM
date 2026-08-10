"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { RoutingCondition, RoutingRule, RoutingStrategy } from "@/lib/types";

const PATH = "/settings/routing";

async function adminCtx() {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return null;
  return { admin: createAdminClient(), tenantId: ctx.tenantId! };
}

export interface RuleInput {
  name: string;
  priority: number;
  conditions: RoutingCondition[];
  strategy: RoutingStrategy;
  target_user_ids: string[];
  is_active: boolean;
}

export async function createRoutingRule(
  data: RuleInput,
): Promise<{ ok: boolean; error?: string; rule?: RoutingRule }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };
  if (data.strategy !== "load" && data.target_user_ids.length === 0) {
    return { ok: false, error: "Select at least one target user." };
  }

  const { data: rule, error } = await ctx.admin
    .from("routing_rules")
    .insert({
      tenant_id: ctx.tenantId,
      name: data.name.trim() || "Routing rule",
      priority: data.priority,
      conditions: data.conditions,
      strategy: data.strategy,
      target_user_ids: data.target_user_ids,
      is_active: data.is_active,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, rule: rule as RoutingRule };
}

export async function updateRoutingRule(
  id: string,
  data: Partial<RuleInput>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name.trim() || "Routing rule";
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.conditions !== undefined) updates.conditions = data.conditions;
  if (data.strategy !== undefined) updates.strategy = data.strategy;
  if (data.target_user_ids !== undefined) updates.target_user_ids = data.target_user_ids;
  if (data.is_active !== undefined) updates.is_active = data.is_active;

  const { error } = await ctx.admin
    .from("routing_rules")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteRoutingRule(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { error } = await ctx.admin
    .from("routing_rules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
