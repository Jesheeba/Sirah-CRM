import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { metaConfigured } from "@/lib/meta";
import IntegrationsClient from "@/components/settings/IntegrationsClient";
import MetaLeadsCard from "@/components/settings/MetaLeadsCard";
import WebToLeadCard from "@/components/settings/WebToLeadCard";
import { buildCaptureUrl } from "@/app/(app)/settings/integrations/lead-capture-actions";
import type { IntegrationSetting, MetaLeadPage } from "@/lib/types";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only

  const sp = await searchParams;
  const first = (v: string | string[] | undefined): string | null =>
    (Array.isArray(v) ? v[0] : v) ?? null;

  // Fetch NON-SECRET columns only — secret columns are unreadable by this client by design.
  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: settingsData }, { data: pagesData }, { data: membersData }, tenantResult] = await Promise.all([
    supabase
      .from("integration_settings")
      .select(
        "id, channel, is_enabled, from_email, from_name, phone_id, business_account_id, sms_sender_id, secret_set, secret_last4",
      ),
    supabase
      .from("meta_lead_pages")
      .select(
        "id, page_id, page_name, is_enabled, subscribed, default_owner_id, connected_by, created_at, updated_at",
      )
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, full_name, email"),
    admin.from("tenants").select("lead_capture_token").eq("id", ctx.tenantId!).maybeSingle(),
  ]);

  const settings = (settingsData ?? []) as IntegrationSetting[];
  const metaPages = (pagesData ?? []) as MetaLeadPage[];
  const members = ((membersData ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
    (m) => ({ id: m.id, name: m.full_name || m.email || "User" }),
  );
  const captureToken = (tenantResult.data as { lead_capture_token?: string } | null)?.lead_capture_token ?? null;
  const captureUrl = captureToken ? buildCaptureUrl(captureToken) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Integrations</h1>
        <p className="text-sm text-slate-500">
          Connect your organization’s own Email and WhatsApp providers, and collect leads straight from
          your Facebook/Instagram ads. Until a channel is configured and enabled, messages fall back to
          opening your mail app / WhatsApp.
        </p>
      </div>

      <MetaLeadsCard
        pages={metaPages}
        members={members}
        configured={metaConfigured()}
        notice={first(sp.meta)}
        reason={first(sp.reason)}
        connectedCount={first(sp.pages)}
      />

      {captureUrl && <WebToLeadCard captureUrl={captureUrl} />}

      <IntegrationsClient initial={settings} />
    </div>
  );
}
