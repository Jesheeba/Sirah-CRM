import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { emailProviderEnabled } from "@/app/(app)/email/actions";
import EmailClient from "@/components/email/EmailClient";
import type { ComposerPrefill } from "@/components/email/EmailComposer";
import type { Communication, CommRelatedType, EmailTemplate } from "@/lib/types";

export default async function EmailPage({
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
      .eq("channel", "email")
      .order("sent_at", { ascending: false })
      .limit(200),
    supabase
      .from("email_templates")
      .select("*")
      .eq("channel", "email")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
    emailProviderEnabled(),
  ]);

  let initialCompose: ComposerPrefill | null = null;
  if (sp.compose) {
    const rtype = (sp.rtype as CommRelatedType | undefined) ?? null;
    initialCompose = {
      to: sp.to ?? "",
      toName: sp.name ?? "",
      subject: sp.subject ?? "",
      body: sp.body ?? "",
      related_to_type: rtype,
      related_to_id: sp.rid ?? null,
      quotation_id: rtype === "quotation" ? sp.rid ?? null : null,
    };
  }

  return (
    <EmailClient
      initial={(commsRes.data ?? []) as Communication[]}
      templates={(tplRes.data ?? []) as EmailTemplate[]}
      providerEnabled={providerEnabled}
      initialCompose={initialCompose}
    />
  );
}
