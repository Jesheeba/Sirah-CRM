import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

interface CandidateDeal {
  id: string;
  tenant_id: string;
  name: string;
  owner_id: string | null;
  last_stage_change_at: string;
  stages: { rotten_after_days: number | null } | { rotten_after_days: number | null }[] | null;
}

function stageRottenDays(stages: CandidateDeal["stages"]): number | null {
  const s = Array.isArray(stages) ? stages[0] : stages;
  return s?.rotten_after_days ?? null;
}

/**
 * Flags deals that have sat in their current stage past that stage's configured
 * threshold, notifying the owner exactly once per staleness episode. Re-firing is
 * naturally prevented by `rotten_notified_at` (cleared by move_deal_stage on any stage
 * change, so a deal that moves and later goes stale again gets a fresh notification).
 * Called once per day from /api/workflows/tick, same as the notification email digest.
 */
export async function processRottenDeals(
  admin: SupabaseClient,
): Promise<{ scanned: number; flagged: number }> {
  const { data } = await admin
    .from("deals")
    .select("id, tenant_id, name, owner_id, last_stage_change_at, stages!inner(rotten_after_days)")
    .eq("status", "open")
    .is("rotten_notified_at", null)
    .not("stages.rotten_after_days", "is", null)
    .limit(BATCH_SIZE);

  const candidates = (data ?? []) as unknown as CandidateDeal[];
  if (!candidates.length) return { scanned: 0, flagged: 0 };

  const now = Date.now();
  const rotten = candidates.filter((d) => {
    const days = stageRottenDays(d.stages);
    if (!days) return false;
    return now - new Date(d.last_stage_change_at).getTime() > days * DAY_MS;
  });

  if (!rotten.length) return { scanned: candidates.length, flagged: 0 };

  for (const deal of rotten) {
    if (!deal.owner_id) continue;

    const { data: shouldNotify } = await admin.rpc("fn_should_notify", {
      p_user: deal.owner_id,
      p_type: "deal_rotten",
    });
    if (shouldNotify === false) continue;

    await admin.from("notifications").insert({
      tenant_id: deal.tenant_id,
      user_id: deal.owner_id,
      type: "deal_rotten",
      title: `Deal going stale: ${deal.name}`,
      link: `/deals/${deal.id}`,
      entity_type: "deal",
      entity_id: deal.id,
    });
  }

  await admin
    .from("deals")
    .update({ rotten_notified_at: new Date().toISOString() })
    .in("id", rotten.map((d) => d.id));

  return { scanned: candidates.length, flagged: rotten.length };
}
