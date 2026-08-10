import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_AFTER_DAYS = 7;
const BATCH_SIZE = 500;

interface LeadRow {
  id: string;
  created_at: string;
}

/**
 * Applies the -10 inactivity decay to leads with no inbound contact in 7 days. Only
 * "live prospect" statuses are eligible (new/contacted) — a qualified/unqualified/
 * converted lead isn't still being chased, so staleness doesn't apply. Re-firing is
 * prevented by checking lead_score_events for a decay already logged in the window,
 * rather than a stored "last decayed at" column — keeps the event log as the single
 * source of truth instead of a second, potentially-drifting timestamp.
 */
export async function processInactivityDecay(
  admin: SupabaseClient,
): Promise<{ scanned: number; decayed: number }> {
  const cutoff = new Date(Date.now() - DECAY_AFTER_DAYS * DAY_MS).toISOString();

  const { data: candidates } = await admin
    .from("leads")
    .select("id, created_at")
    .in("status", ["new", "contacted"])
    .is("deleted_at", null)
    .lt("created_at", cutoff)
    .limit(BATCH_SIZE);

  const leads = (candidates ?? []) as LeadRow[];
  if (!leads.length) return { scanned: 0, decayed: 0 };

  const leadIds = leads.map((l) => l.id);

  // Leads with any inbound contact since the cutoff are still "live" — exclude them.
  const { data: recentContact } = await admin
    .from("communications")
    .select("related_to_id")
    .eq("related_to_type", "lead")
    .in("related_to_id", leadIds)
    .eq("direction", "inbound")
    .gte("created_at", cutoff);
  const contactedRecently = new Set((recentContact ?? []).map((r) => r.related_to_id as string));

  // Leads already decayed within the window — don't decay again until it re-opens.
  const { data: recentDecay } = await admin
    .from("lead_score_events")
    .select("lead_id")
    .in("lead_id", leadIds)
    .eq("action", "inactivity_decay")
    .gte("created_at", cutoff);
  const decayedRecently = new Set((recentDecay ?? []).map((r) => r.lead_id as string));

  const due = leads.filter((l) => !contactedRecently.has(l.id) && !decayedRecently.has(l.id));
  if (!due.length) return { scanned: leads.length, decayed: 0 };

  for (const lead of due) {
    await admin.rpc("fn_apply_lead_score", { p_lead_id: lead.id, p_action: "inactivity_decay" });
  }

  return { scanned: leads.length, decayed: due.length };
}
