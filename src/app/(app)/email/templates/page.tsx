import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import TemplatesClient from "@/components/templates/TemplatesClient";
import type { EmailTemplate } from "@/lib/types";

export default async function EmailTemplatesPage() {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;

  const { data } = await supabase
    .from("email_templates")
    .select("*")
    .eq("channel", "email")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <TemplatesClient
      initial={(data ?? []) as EmailTemplate[]}
      canManage={ctx.isManager || ctx.isAdmin}
      channel="email"
      showSubject
      title="Email templates"
      backHref="/email"
      backLabel="Email"
    />
  );
}
