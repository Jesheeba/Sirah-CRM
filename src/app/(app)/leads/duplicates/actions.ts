"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function mergeLeads(
  primaryId: string,
  duplicateIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin && !ctx?.isManager) return { ok: false, error: "Admin or Manager access required" };
  if (!duplicateIds.length) return { ok: false, error: "Select at least one duplicate to merge." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_merge_leads", {
    p_primary_id: primaryId,
    p_duplicate_ids: duplicateIds,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads/duplicates");
  revalidatePath("/leads");
  return { ok: true };
}
