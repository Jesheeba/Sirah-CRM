import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import QuotationDetailClient from "@/components/quotations/QuotationDetailClient";
import type { Quotation, QuotationItem } from "@/lib/types";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: quotation }, itemsRes, productsRes, accountsRes, contactsRes, dealsRes] =
    await Promise.all([
      supabase.from("quotations").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
      supabase.from("quotation_items").select("*").eq("quotation_id", id).order("position"),
      supabase
        .from("products")
        .select("id, name, sku, description, unit_price, tax_rate")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("contacts").select("id, first_name, last_name, email").order("created_at", { ascending: false }),
      supabase.from("deals").select("id, name").is("deleted_at", null).order("created_at", { ascending: false }),
    ]);

  if (!quotation) notFound();

  const canEdit =
    ctx.isAdmin || ctx.isManager || (quotation as Quotation).owner_id === ctx.userId;

  return (
    <QuotationDetailClient
      quotation={quotation as Quotation}
      items={(itemsRes.data ?? []) as QuotationItem[]}
      products={(productsRes.data ?? []) as ProductPick[]}
      accounts={(accountsRes.data ?? []) as { id: string; name: string }[]}
      contacts={(contactsRes.data ?? []) as ContactPick[]}
      deals={(dealsRes.data ?? []) as { id: string; name: string }[]}
      canEdit={canEdit}
    />
  );
}

type ProductPick = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  tax_rate: number;
};
type ContactPick = { id: string; first_name: string | null; last_name: string | null; email: string | null };
