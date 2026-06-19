"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/reports";
import {
  PRODUCT_STATUSES,
  type Product,
  type ProductCategory,
  type ProductStatus,
} from "@/lib/types";

const STATUS_STYLE: Record<ProductStatus, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-slate-100 text-slate-500",
  archived: "bg-amber-100 text-amber-700",
};

const EMPTY = { name: "", sku: "", unit_price: "", currency: "INR", category_id: "", status: "active" as ProductStatus };

export default function ProductsClient({
  initial,
  categories,
  canManage,
}: {
  initial: Product[];
  categories: ProductCategory[];
  canManage: boolean;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Product[]>(initial);
  const [cats, setCats] = useState<ProductCategory[]>(categories);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [newCat, setNewCat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((p) => {
    if (q && !(`${p.name} ${p.sku ?? ""}`.toLowerCase().includes(q))) return false;
    if (catFilter && p.category_id !== catFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    return true;
  });

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Product name is required.");
    setBusy(true);
    const { data, error } = await supabase
      .from("products")
      .insert({
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        unit_price: Number(form.unit_price) || 0,
        currency: form.currency.trim() || "INR",
        category_id: form.category_id || null,
        status: form.status,
      })
      .select("*, product_categories(name)")
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setRows((r) => [data as Product, ...r]);
    setForm({ ...EMPTY });
    setShowForm(false);
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    setError(null);
    const { data, error } = await supabase
      .from("product_categories")
      .insert({ name: newCat.trim() })
      .select("*")
      .single();
    if (error) return setError(error.message);
    setCats((c) => [...c, data as ProductCategory].sort((a, b) => a.name.localeCompare(b.name)));
    setNewCat("");
  }

  async function deleteCategory(id: string) {
    const prev = cats;
    setCats((c) => c.filter((x) => x.id !== id));
    const { error } = await supabase.from("product_categories").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setCats(prev);
    } else {
      setRows((r) => r.map((p) => (p.category_id === id ? { ...p, category_id: null, product_categories: null } : p)));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Products</h1>
        {canManage && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowCats((s) => !s)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Categories
            </button>
            <button
              onClick={() => setShowForm((s) => !s)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + New product
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {canManage && showCats && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Categories</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {cats.length === 0 && <span className="text-sm text-slate-400">No categories yet.</span>}
            {cats.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                {c.name}
                <button onClick={() => deleteCategory(c.id)} className="text-slate-400 hover:text-red-600">
                  ×
                </button>
              </span>
            ))}
          </div>
          <form onSubmit={addCategory} className="flex gap-2">
            <input
              placeholder="New category"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button type="submit" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Add
            </button>
          </form>
        </div>
      )}

      {canManage && showForm && (
        <form onSubmit={createProduct} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
          <input
            placeholder="Product name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <input
            placeholder="SKU"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="Unit price"
            value={form.unit_price}
            onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            value={form.category_id}
            onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">— Category —</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ProductStatus })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:max-w-xs"
        />
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
        >
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  {rows.length === 0 ? "No products yet." : "No products match your filters."}
                </td>
              </tr>
            )}
            {visible.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/products/${p.id}`} className="text-brand hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.sku || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{p.product_categories?.name ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  {money(Number(p.unit_price), p.currency)}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[p.status]}`}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
