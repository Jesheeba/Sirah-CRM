"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import CustomFieldInputs from "@/components/record/CustomFieldInputs";
import { cleanCustomValues, firstRequiredMissing } from "@/lib/customFields";
import type { Account, CustomFieldDef } from "@/lib/types";

const EMPTY = { name: "", website: "", industry: "", phone: "" };

export default function AccountsClient({
  initial,
  userId,
  customFields,
}: {
  initial: Account[];
  userId: string;
  customFields: CustomFieldDef[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Account[]>(initial);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Account name is required.");
    const missing = firstRequiredMissing(customFields, customValues);
    if (missing) return setError(`${missing} is required.`);
    setBusy(true);
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        name: form.name.trim(),
        website: form.website || null,
        industry: form.industry || null,
        phone: form.phone || null,
        custom_fields: cleanCustomValues(customFields, customValues),
        owner_id: userId,
        created_by: userId,
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setRows((r) => [data as Account, ...r]);
    setForm({ ...EMPTY });
    setCustomValues({});
    setShow(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Accounts</h1>
        <button
          onClick={() => setShow((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Add account
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {show && (
        <form
          onSubmit={create}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4"
        >
          {(
            [
              ["name", "Name *"],
              ["industry", "Industry"],
              ["website", "Website"],
              ["phone", "Phone"],
            ] as const
          ).map(([k, label]) => (
            <input
              key={k}
              placeholder={label}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          ))}
          <CustomFieldInputs
            defs={customFields}
            values={customValues}
            onChange={(k, v) => setCustomValues((p) => ({ ...p, [k]: v }))}
          />
          <div className="sm:col-span-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save account"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Website</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No accounts yet — add your first company.
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/accounts/${a.id}`} className="text-brand hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.industry ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{a.phone ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{a.website ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
