import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { type AdminTenantRow } from "@/lib/platform";
import TenantsClient from "@/components/platform/TenantsClient";

export default async function TenantsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_tenants", { p_search: null, p_status: null });
  return <TenantsClient initial={(data ?? []) as AdminTenantRow[]} />;
}
