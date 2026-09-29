import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import { metaConfigured } from "@/lib/meta";
import { aiConfigured } from "@/lib/ai";
import IntegrationsClient from "@/components/settings/IntegrationsClient";
import MetaLeadsCard from "@/components/settings/MetaLeadsCard";
import WebToLeadCard from "@/components/settings/WebToLeadCard";
import InstagramDmCard from "@/components/settings/InstagramDmCard";
import InstagramCommentCard from "@/components/settings/InstagramCommentCard";
import type { IntegrationSetting, MetaLeadPage } from "@/lib/types";
import type { InstagramAutomationRule } from "@/lib/instagram-automation";
import type { InstagramCommentRule } from "@/lib/instagram-comment-automation";

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

  const [{ data: settingsData }, { data: pagesData }, { data: rulesData }, { data: commentRulesData }, { data: membersData }, tenantResult, deviceRow, cloudRow, razorpayRow] = await Promise.all([
    supabase
      .from("integration_settings")
      .select(
        "id, channel, is_enabled, from_email, from_name, phone_id, business_account_id, sms_sender_id, api_endpoint, razorpay_key_id, secret_set, secret_last4, app_secret_set",
      ),
    supabase
      .from("meta_lead_pages")
      .select(
        "id, page_id, page_name, is_enabled, subscribed, default_owner_id, connected_by, ig_business_id, ig_dm_enabled, ig_comment_automation_enabled, created_at, updated_at",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("instagram_automation_rules")
      .select(
        "id, page_id, rule_type, priority, is_enabled, match_keywords, reply_text, reply_buttons, payload, ai_system_prompt, require_follower, reply_image_url, reply_link_url, reply_link_title",
      ),
    supabase
      .from("instagram_comment_rules")
      .select("id, page_id, ig_media_id, rule_type, priority, is_enabled, match_keywords, action_type, reply_text, dm_text"),
    supabase.from("profiles").select("id, full_name, email"),
    admin.from("tenants").select("lead_capture_token").eq("id", ctx.tenantId!).maybeSingle(),
    // webhook_token is a secret — only the service-role admin client can read it.
    // We construct the full URL here (server component) and pass only the URL string to the client.
    admin
      .from("integration_settings")
      .select("webhook_token")
      .eq("tenant_id", ctx.tenantId!)
      .eq("channel", "whatsapp_device")
      .maybeSingle(),
    // verify_token is a secret — read server-side, passed as a plain string prop (not raw DB column).
    admin
      .from("integration_settings")
      .select("verify_token")
      .eq("tenant_id", ctx.tenantId!)
      .eq("channel", "whatsapp")
      .maybeSingle(),
    // webhook_token is a secret — only the service-role admin client can read it.
    admin
      .from("integration_settings")
      .select("webhook_token")
      .eq("tenant_id", ctx.tenantId!)
      .eq("channel", "razorpay")
      .maybeSingle(),
  ]);

  const settings = (settingsData ?? []) as IntegrationSetting[];
  const rawMetaPages = (pagesData ?? []) as Omit<MetaLeadPage, "has_received_lead">[];

  // A page's own Business must separately grant this app access via Instant Forms → CRM
  // setup (Meta's Lead Access Manager) — App Review approval never covers this. Until a
  // page has produced at least one real event, show the admin a reminder to complete it.
  const pageIds = rawMetaPages.map((p) => p.page_id);
  const { data: pagesWithEvents } = pageIds.length
    ? await admin.from("meta_lead_events").select("page_id").in("page_id", pageIds)
    : { data: [] as { page_id: string | null }[] };
  const pagesWithLeadEvents = new Set((pagesWithEvents ?? []).map((r) => r.page_id));
  const metaPages: MetaLeadPage[] = rawMetaPages.map((p) => ({
    ...p,
    has_received_lead: pagesWithLeadEvents.has(p.page_id),
  }));
  const rulesByPage = ((rulesData ?? []) as (InstagramAutomationRule & { page_id: string })[]).reduce<
    Record<string, InstagramAutomationRule[]>
  >((acc, r) => {
    (acc[r.page_id] ??= []).push(r);
    return acc;
  }, {});
  const commentRulesByPage = ((commentRulesData ?? []) as (InstagramCommentRule & { page_id: string })[]).reduce<
    Record<string, InstagramCommentRule[]>
  >((acc, r) => {
    (acc[r.page_id] ??= []).push(r);
    return acc;
  }, {});
  const members = ((membersData ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
    (m) => ({ id: m.id, name: m.full_name || m.email || "User" }),
  );
  const captureToken = (tenantResult.data as { lead_capture_token?: string } | null)?.lead_capture_token ?? null;
  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const captureUrl = captureToken ? `${appBase}/api/leads/capture?token=${captureToken}` : null;

  // Construct webhook URLs server-side — secrets never leave this server component.
  const deviceToken = (deviceRow.data as { webhook_token?: string } | null)?.webhook_token ?? null;
  const deviceWebhookUrl = deviceToken
    ? `${appBase}/api/whatsapp/device/webhook/${deviceToken}`
    : null;

  // Cloud webhook URL is static (no secret in the URL — auth is done via verify_token + HMAC).
  const cloudWebhookUrl = `${appBase}/api/whatsapp/cloud/webhook`;
  const cloudVerifyToken =
    (cloudRow.data as { verify_token?: string } | null)?.verify_token ?? null;

  const razorpayToken = (razorpayRow.data as { webhook_token?: string } | null)?.webhook_token ?? null;
  const razorpayWebhookUrl = razorpayToken
    ? `${appBase}/api/payments/razorpay/webhook/${razorpayToken}`
    : null;

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
        notice={first(sp.via) === "instagram" ? null : first(sp.meta)}
        reason={first(sp.reason)}
        connectedCount={first(sp.pages)}
      />

      <InstagramDmCard
        pages={metaPages}
        rulesByPage={rulesByPage}
        aiConfigured={aiConfigured()}
        configured={metaConfigured()}
        notice={first(sp.via) === "instagram" ? first(sp.meta) : null}
        reason={first(sp.reason)}
        connectedCount={first(sp.pages)}
      />

      <InstagramCommentCard pages={metaPages} rulesByPage={commentRulesByPage} />

      {captureUrl && <WebToLeadCard captureUrl={captureUrl} />}

      <IntegrationsClient
        initial={settings}
        webhookUrl={deviceWebhookUrl}
        cloudWebhookUrl={cloudWebhookUrl}
        cloudVerifyToken={cloudVerifyToken}
        razorpayWebhookUrl={razorpayWebhookUrl}
      />
    </div>
  );
}
