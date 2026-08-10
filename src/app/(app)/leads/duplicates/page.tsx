import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DuplicatesClient from "./DuplicatesClient";
import type { Lead } from "@/lib/types";

interface DupGroup {
  match_key: string;
  match_type: "email" | "phone";
  lead_ids: string[];
}

export default async function LeadDuplicatesPage() {
  const supabase = await createClient();

  const { data: groupsData } = await supabase.rpc("fn_scan_duplicate_lead_groups");
  const groups = (groupsData ?? []) as DupGroup[];

  const allIds = Array.from(new Set(groups.flatMap((g) => g.lead_ids)));
  const { data: leadsData } = allIds.length
    ? await supabase.from("leads").select("*").in("id", allIds)
    : { data: [] };
  const leadsById = new Map((leadsData ?? []).map((l) => [l.id, l as Lead]));

  const resolvedGroups = groups
    .map((g) => ({
      key: `${g.match_type}:${g.match_key}`,
      matchType: g.match_type,
      leads: g.lead_ids.map((id) => leadsById.get(id)).filter((l): l is Lead => !!l),
    }))
    .filter((g) => g.leads.length > 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/leads" className="hover:underline">Leads</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">Duplicates</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-800">Potential Duplicate Leads</h1>
        <p className="text-sm text-slate-500">
          Leads sharing the same email or phone number. Pick a primary lead per group and merge —
          notes, activities, tasks, communications, and sequence enrollments move to the primary;
          the others are archived (soft-deleted, not destroyed).
        </p>
      </div>

      <DuplicatesClient groups={resolvedGroups} />
    </div>
  );
}
