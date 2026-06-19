import { createClient } from "@/lib/supabase/server";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import ContactsClient from "@/components/contacts/ContactsClient";
import type { Contact } from "@/lib/types";

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [contactsRes, accountsRes, customFields] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, accounts(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("accounts").select("id, name").is("deleted_at", null).order("name"),
    fetchCustomFieldDefs(supabase, "contacts"),
  ]);

  return (
    <ContactsClient
      initial={(contactsRes.data ?? []) as Contact[]}
      accounts={(accountsRes.data ?? []) as { id: string; name: string }[]}
      userId={user!.id}
      customFields={customFields}
    />
  );
}
