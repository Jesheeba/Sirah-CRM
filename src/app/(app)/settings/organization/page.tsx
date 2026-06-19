import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import OrganizationClient, { type OrgProfile } from "@/components/settings/OrganizationClient";

export default async function OrganizationPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only
  if (!ctx.tenantId) redirect("/onboarding");

  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, name, slug, plan_tier, currency, timezone, locale")
    .eq("id", ctx.tenantId)
    .maybeSingle();

  if (!data) redirect("/dashboard");
  const org = data as OrgProfile;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Organization</h1>
        <p className="text-sm text-slate-500">
          Your organization’s profile and regional defaults. These apply across the workspace.
        </p>
      </div>
      <OrganizationClient initial={org} />
    </div>
  );
}
