import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { type TenantDetail } from "@/lib/platform";
import TenantDetailClient from "@/components/platform/TenantDetailClient";
import type {
  LeadFeedKeyInfo,
  WebhookChannelInfo,
  WebhookDeliveryInfo,
} from "@/app/(platform)/platform/actions";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_tenant_detail", { p_tenant: id });
  if (!data) notFound();

  // Key metadata only — the keys are stored hashed and can't be shown again. The table is
  // service-role only (the keys grant read access to lead data).
  const admin = createAdminClient();
  const { data: keys } = await admin
    .from("lead_feed_keys")
    .select("id, name, key_prefix, created_at, last_used_at, last_used_via, revoked_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false });

  // Inbound webhook channels: metadata only — the signing secrets never leave the server.
  const { data: channels } = await admin
    .from("lead_webhook_channels")
    .select("id, channel, name, is_enabled, created_at, secret_rotated_at, last_used_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false });
  const channelIds = (channels ?? []).map((c) => c.id as string);
  const { data: deliveries } = channelIds.length
    ? await admin
        .from("lead_webhook_deliveries")
        .select("id, channel_id, request_id, http_status, error_code, received, created, updated, failed, created_at")
        .in("channel_id", channelIds)
        .order("created_at", { ascending: false })
        .limit(15)
    : { data: [] };

  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

  return (
    <TenantDetailClient
      tenant={data as TenantDetail}
      leadFeedKeys={(keys ?? []) as LeadFeedKeyInfo[]}
      webhookChannels={(channels ?? []) as WebhookChannelInfo[]}
      webhookDeliveries={(deliveries ?? []) as WebhookDeliveryInfo[]}
      appBase={appBase}
    />
  );
}
