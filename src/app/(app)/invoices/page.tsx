import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import InvoicesClient from "@/components/invoices/InvoicesClient";
import type { Invoice } from "@/lib/types";

export const metadata = { title: "Invoices — Sirah CRM" };

export default async function InvoicesPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*, accounts(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Invoices</h1>
          <p className="text-sm text-slate-500">Track and manage your sales invoices.</p>
        </div>
      </div>
      <InvoicesClient
        invoices={(data ?? []) as Invoice[]}
        canCreate={ctx.isAdmin || ctx.isManager}
      />
    </div>
  );
}
