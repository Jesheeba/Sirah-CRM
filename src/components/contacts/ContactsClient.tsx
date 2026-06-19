"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import CustomFieldInputs from "@/components/record/CustomFieldInputs";
import { cleanCustomValues, firstRequiredMissing } from "@/lib/customFields";
import type { Contact, CustomFieldDef } from "@/lib/types";

const EMPTY = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  title: "",
  account_id: "",
};

function name(c: Contact) {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)";
}

export default function ContactsClient({
  initial,
  accounts,
  userId,
  customFields,
}: {
  initial: Contact[];
  accounts: { id: string; name: string }[];
  userId: string;
  customFields: CustomFieldDef[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Contact[]>(initial);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim() && !form.last_name.trim())
      return setError("Enter a first or last name.");
    const missing = firstRequiredMissing(customFields, customValues);
    if (missing) return setError(`${missing} is required.`);
    setBusy(true);
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        email: form.email || null,
        phone: form.phone || null,
        title: form.title || null,
        account_id: form.account_id || null,
        custom_fields: cleanCustomValues(customFields, customValues),
        owner_id: userId,
        created_by: userId,
      })
      .select("*, accounts(name)")
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setRows((r) => [data as Contact, ...r]);
    setForm({ ...EMPTY });
    setCustomValues({});
    setShow(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Contacts</h1>
        <button
          onClick={() => setShow((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Add contact
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
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3"
        >
          {(
            [
              ["first_name", "First name"],
              ["last_name", "Last name"],
              ["title", "Title"],
              ["email", "Email"],
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
          <select
            value={form.account_id}
            onChange={(e) => setForm({ ...form, account_id: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">— No account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <CustomFieldInputs
            defs={customFields}
            values={customValues}
            onChange={(k, v) => setCustomValues((p) => ({ ...p, [k]: v }))}
          />
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save contact"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No contacts yet — add your first person.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/contacts/${c.id}`} className="text-brand hover:underline">
                    {name(c)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{c.title ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{c.accounts?.name ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{c.email ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
