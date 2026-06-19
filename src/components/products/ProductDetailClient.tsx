"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  PRODUCT_STATUSES,
  type Product,
  type ProductCategory,
  type ProductStatus,
} from "@/lib/types";

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50 disabled:text-slate-500";

export default function ProductDetailClient({
  product,
  categories,
  canManage,
}: {
  product: Product;
  categories: ProductCategory[];
  canManage: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [unitPrice, setUnitPrice] = useState(String(product.unit_price ?? 0));
  const [currency, setCurrency] = useState(product.currency);
  const [taxRate, setTaxRate] = useState(String(product.tax_rate ?? 0));
  const [categoryId, setCategoryId] = useState(product.category_id ?? "");
  const [status, setStatus] = useState<ProductStatus>(product.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ro = !canManage;

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("products")
      .update({
        name: name.trim(),
        sku: sku.trim() || null,
        description: description.trim() || null,
        unit_price: Number(unitPrice) || 0,
        currency: currency.trim() || "INR",
        tax_rate: Number(taxRate) || 0,
        category_id: categoryId || null,
        status,
      })
      .eq("id", product.id);
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function remove() {
    setError(null);
    const { error } = await supabase
      .from("products")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", product.id);
    if (error) return setError(error.message);
    router.push("/products");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/products" className="hover:underline">Products</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{name}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{name || "Product"}</h1>
        {canManage && (
          <button
            onClick={remove}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
          >
            Delete
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {ro && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Read-only — only Admins and Managers can edit the catalog.
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>SKU</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus)}
              disabled={ro}
              className={`${INPUT} capitalize`}
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Unit price</label>
            <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Tax rate (%)</label>
            <input type="number" min={0} step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={ro} className={INPUT}>
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={ro} rows={3} className={INPUT} />
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm text-green-600">Saved ✓</span>}
          </div>
        )}
      </div>
    </div>
  );
}
