import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { type PlatformConfig, type FeatureFlag } from "@/lib/platform";
import PlatformSettingsClient from "@/components/platform/PlatformSettingsClient";

export default async function PlatformSettingsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: config }, { data: flags }] = await Promise.all([
    supabase.rpc("admin_platform_settings_get"),
    supabase.rpc("admin_list_feature_flags"),
  ]);
  return (
    <PlatformSettingsClient
      config={(config ?? {}) as PlatformConfig}
      flags={(flags ?? []) as FeatureFlag[]}
    />
  );
}
