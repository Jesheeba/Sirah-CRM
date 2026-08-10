import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import RoutingClient from "./RoutingClient";
import type { RoutingRule } from "@/lib/types";

export default async function RoutingPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/settings/branding");

  const admin = createAdminClient();

  const [{ data: rulesData }, { data: membersData }, customFields] = await Promise.all([
    admin.from("routing_rules").select("*").eq("tenant_id", ctx.tenantId!).order("priority"),
    admin.from("profiles").select("id, full_name, email").eq("tenant_id", ctx.tenantId!),
    fetchCustomFieldDefs(admin, "leads"),
  ]);

  const members = ((membersData ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
    (m) => ({ id: m.id, name: m.full_name || m.email || "User" }),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Lead Routing</h1>
        <p className="text-sm text-slate-500">
          Automatically assign new leads to reps based on rules — round robin, least-loaded, or a
          specific rep — filtered by source, territory (via a custom field), or any lead attribute.
        </p>
      </div>

      <RoutingClient initialRules={(rulesData ?? []) as RoutingRule[]} members={members} customFields={customFields} />
    </div>
  );
}
