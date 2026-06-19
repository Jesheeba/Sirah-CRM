import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import ProductsClient from "@/components/products/ProductsClient";
import type { Product, ProductCategory } from "@/lib/types";

export default async function ProductsPage() {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;

  const [prodRes, catRes] = await Promise.all([
    supabase
      .from("products")
      .select("*, product_categories(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("product_categories").select("*").order("name"),
  ]);

  return (
    <ProductsClient
      initial={(prodRes.data ?? []) as Product[]}
      categories={(catRes.data ?? []) as ProductCategory[]}
      canManage={ctx.isManager || ctx.isAdmin}
    />
  );
}
