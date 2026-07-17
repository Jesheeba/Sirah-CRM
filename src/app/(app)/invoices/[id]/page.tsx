import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import InvoiceDetailClient from "@/components/invoices/InvoiceDetailClient";
import type { Invoice, InvoiceItem } from "@/lib/types";

type ProductPick = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  tax_rate: number;
};
type ContactPick = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: invoice }, itemsRes, productsRes, accountsRes, contactsRes, dealsRes, brandingRes] =
    await Promise.all([
      supabase.from("invoices").select("*, accounts(name)").eq("id", id).is("deleted_at", null).maybeSingle(),
      supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"),
      supabase
        .from("products")
        .select("id, name, sku, description, unit_price, tax_rate")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("contacts").select("id, first_name, last_name, email").order("created_at", { ascending: false }),
      supabase.from("deals").select("id, name").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("organization_branding").select("seller_gstin, seller_state_code").maybeSingle(),
    ]);

  if (!invoice) notFound();

  const canEdit =
    ctx.isAdmin || ctx.isManager || (invoice as Invoice).owner_id === ctx.userId;

  return (
    <InvoiceDetailClient
      invoice={invoice as Invoice}
      items={(itemsRes.data ?? []) as InvoiceItem[]}
      products={(productsRes.data ?? []) as ProductPick[]}
      accounts={(accountsRes.data ?? []) as { id: string; name: string }[]}
      contacts={(contactsRes.data ?? []) as ContactPick[]}
      deals={(dealsRes.data ?? []) as { id: string; name: string }[]}
      sellerGstin={(brandingRes.data as { seller_gstin: string | null; seller_state_code: string | null } | null)?.seller_gstin ?? null}
      sellerStateCode={(brandingRes.data as { seller_gstin: string | null; seller_state_code: string | null } | null)?.seller_state_code ?? null}
      canEdit={canEdit}
    />
  );
}
