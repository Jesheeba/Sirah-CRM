import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import TargetsClient from "./TargetsClient";
import type { SalesTarget } from "@/lib/types";

export default async function TargetsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/settings/branding");

  const admin = createAdminClient();
  const [{ data: targetsData }, { data: membersData }] = await Promise.all([
    admin.from("sales_targets").select("*").eq("tenant_id", ctx.tenantId!),
    admin.from("profiles").select("id, full_name, email").eq("tenant_id", ctx.tenantId!),
  ]);

  const members = ((membersData ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
    (m) => ({ id: m.id, name: m.full_name || m.email || "User" }),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Sales Targets</h1>
        <p className="text-sm text-slate-500">
          Set a monthly revenue or deals-won target per rep, or a whole-team target. Progress is
          shown on each rep's dashboard, computed live from won deals — never a stored snapshot.
        </p>
      </div>

      <TargetsClient initialTargets={(targetsData ?? []) as SalesTarget[]} members={members} />
    </div>
  );
}
