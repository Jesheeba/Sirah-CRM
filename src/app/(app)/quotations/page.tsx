import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import QuotationsClient from "@/components/quotations/QuotationsClient";
import type { Quotation } from "@/lib/types";

export default async function QuotationsPage() {
  const supabase = await createClient();
  await getUserContext();

  const { data } = await supabase
    .from("quotations")
    .select("*, accounts(name), deals(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return <QuotationsClient initial={(data ?? []) as Quotation[]} />;
}
