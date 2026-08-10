"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const PATH = "/settings/lead-scoring";

export async function upsertLeadScoringRule(
  action: string,
  points: number,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return { ok: false, error: "Admin access required" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_scoring_rules")
    .upsert(
      { tenant_id: ctx.tenantId, action, points, is_active: isActive, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,action" },
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
