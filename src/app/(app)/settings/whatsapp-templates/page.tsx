import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { resolveWhatsAppConfig } from "@/lib/integrations";
import WhatsAppTemplatesClient from "@/components/settings/WhatsAppTemplatesClient";
import type { WhatsAppTemplate } from "@/lib/types";

export default async function WhatsAppTemplatesPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only, mirrors /settings/integrations

  const cfg = await resolveWhatsAppConfig(ctx.tenantId);
  const wabaConnected = cfg.mode === "tenant_cloud" && Boolean(cfg.wabaId);

  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_templates")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <WhatsAppTemplatesClient
      initial={(data ?? []) as WhatsAppTemplate[]}
      wabaConnected={wabaConnected}
    />
  );
}
