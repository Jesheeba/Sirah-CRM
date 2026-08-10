import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import LeadScoringClient from "./LeadScoringClient";
import type { LeadScoringRule } from "@/lib/types";

export default async function LeadScoringPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/settings/branding");

  const admin = createAdminClient();
  const { data } = await admin.from("lead_scoring_rules").select("*").eq("tenant_id", ctx.tenantId!);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Lead Scoring</h1>
        <p className="text-sm text-slate-500">
          Points are applied automatically as leads engage — an opened email, a reply, 7 days of
          silence. Turn an action off to stop scoring it; points shown are the current default
          until you save an override.
        </p>
      </div>

      <LeadScoringClient initialRules={(data ?? []) as LeadScoringRule[]} />
    </div>
  );
}
