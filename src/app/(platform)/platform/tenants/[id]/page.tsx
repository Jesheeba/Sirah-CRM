import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  return <TenantDetailClient tenant={data as TenantDetail} />;
}
