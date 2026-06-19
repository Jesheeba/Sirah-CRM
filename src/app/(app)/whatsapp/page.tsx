import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { whatsappProviderEnabled } from "@/app/(app)/whatsapp/actions";
import WhatsAppClient from "@/components/whatsapp/WhatsAppClient";
import type { WaPrefill } from "@/components/whatsapp/WhatsAppComposer";
import type { Communication, CommRelatedType, EmailTemplate } from "@/lib/types";

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  await getUserContext();
  const sp = await searchParams;

  const [commsRes, tplRes, providerEnabled] = await Promise.all([
    supabase
      .from("communications")
      .select("*")
      .eq("channel", "whatsapp")
      .order("sent_at", { ascending: false })
      .limit(200),
    supabase
      .from("email_templates")
      .select("*")
      .eq("channel", "whatsapp")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
    whatsappProviderEnabled(),
  ]);

  let initialCompose: WaPrefill | null = null;
  if (sp.compose) {
    const rtype = (sp.rtype as CommRelatedType | undefined) ?? null;
    initialCompose = {
      to: sp.to ?? "",
      toName: sp.name ?? "",
      body: sp.body ?? "",
      related_to_type: rtype,
      related_to_id: sp.rid ?? null,
      quotation_id: rtype === "quotation" ? sp.rid ?? null : null,
    };
  }

  return (
    <WhatsAppClient
      initial={(commsRes.data ?? []) as Communication[]}
      templates={(tplRes.data ?? []) as EmailTemplate[]}
      providerEnabled={providerEnabled}
      initialCompose={initialCompose}
    />
  );
}
