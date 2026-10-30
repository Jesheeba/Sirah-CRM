import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { type TenantDetail } from "@/lib/platform";
import TenantDetailClient from "@/components/platform/TenantDetailClient";

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

  // The feed token table is service-role only (it grants read access to lead data).
  const { data: feed } = await createAdminClient()
    .from("tenant_lead_feeds")
    .select("token")
    .eq("tenant_id", id)
    .maybeSingle();
  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

  return (
    <TenantDetailClient
      tenant={data as TenantDetail}
      leadFeedToken={(feed?.token as string | undefined) ?? null}
      appBase={appBase}
    />
  );
}
