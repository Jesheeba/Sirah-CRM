import { createClient } from "@/lib/supabase/server";
import { fetchCustomFieldDefs } from "@/lib/customFields";
import AccountsClient from "@/components/accounts/AccountsClient";
import type { Account } from "@/lib/types";

export default async function AccountsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data }, customFields] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    fetchCustomFieldDefs(supabase, "accounts"),
  ]);

  return (
    <AccountsClient
      initial={(data ?? []) as Account[]}
      userId={user!.id}
      customFields={customFields}
    />
  );
}
