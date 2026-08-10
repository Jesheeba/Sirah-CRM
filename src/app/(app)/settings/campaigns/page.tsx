import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import CampaignsClient from "./CampaignsClient";
import type { EmailCampaign } from "@/lib/types";

export default async function CampaignsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/settings/branding");

  const admin = createAdminClient();
  const { data } = await admin
    .from("email_campaigns")
    .select("*")
    .eq("tenant_id", ctx.tenantId!)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Bulk Email Campaigns</h1>
        <p className="text-sm text-slate-500">
          Send a personalized email to a segment of leads or contacts. Sends batch over the daily
          cron rather than all at once, and automatically skip anyone who has unsubscribed.
        </p>
      </div>

      <CampaignsClient initialCampaigns={(data ?? []) as EmailCampaign[]} />
    </div>
  );
}
