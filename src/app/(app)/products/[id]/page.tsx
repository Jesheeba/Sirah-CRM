import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import ProductDetailClient from "@/components/products/ProductDetailClient";
import type { Product, ProductCategory } from "@/lib/types";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: product }, catRes] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("product_categories").select("*").order("name"),
  ]);
  if (!product) notFound();

  return (
    <ProductDetailClient
      product={product as Product}
      categories={(catRes.data ?? []) as ProductCategory[]}
      canManage={ctx.isManager || ctx.isAdmin}
    />
  );
}
