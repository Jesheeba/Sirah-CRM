"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CustomFieldInputs from "@/components/record/CustomFieldInputs";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PhoneInput from "@/components/ui/PhoneInput";
import { cleanCustomValues, firstRequiredMissing } from "@/lib/customFields";
import { DEFAULT_COUNTRY, isValidNationalNumber, toInternational } from "@/lib/countries";
import { isValidEmail } from "@/lib/validation";
import { LEAD_STATUSES, type CustomFieldDef, type Lead, type LeadStatus } from "@/lib/types";

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  qualified: "bg-violet-100 text-violet-700",
  unqualified: "bg-slate-200 text-slate-600",
  converted: "bg-green-100 text-green-700",
};

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  company: "",
  website: "",
  industry: "",
  email: "",
  phone: "",
  source: "",
};

function leadName(l: Lead) {
  const n = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();
  return n || l.company || "(no name)";
}

export default function LeadsClient({
  initialLeads,
  userId,
  defaultMine,
  customFields,
}: {
  initialLeads: Lead[];
  userId: string;
  defaultMine: boolean;
  customFields: CustomFieldDef[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [view, setView] = useState<"mine" | "all">(defaultMine ? "mine" : "all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function createLead(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const hasName = form.first_name.trim() || form.last_name.trim() || form.company.trim();
    const hasContact = form.email.trim() || form.phone.trim();
    if (!hasName) return setError("Enter a name or a company.");
    if (!hasContact) return setError("Enter an email or a phone number.");
    if (form.email.trim() && !isValidEmail(form.email)) {
      return setError("Enter a valid email address (e.g. name@example.com).");
    }
    if (form.phone.trim() && !isValidNationalNumber(phoneCountry, form.phone)) {
      return setError("Enter a valid phone number for the selected country.");
    }
    const missing = firstRequiredMissing(customFields, customValues);
    if (missing) return setError(`${missing} is required.`);

    setBusy(true);
    const { data, error } = await supabase
      .from("leads")
      .insert({
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        company: form.company || null,
        website: form.website || null,
        industry: form.industry || null,
        email: form.email.trim() || null,
        phone: toInternational(phoneCountry, form.phone) || null,
        source: form.source || null,
        status: "new",
        score: 0,
        custom_fields: cleanCustomValues(customFields, customValues),
        owner_id: userId,
        created_by: userId,
      })
      .select()
      .single();
    setBusy(false);

    if (error) return setError(error.message);
    setLeads((prev) => [data as Lead, ...prev]);
    setForm({ ...EMPTY_FORM });
    setPhoneCountry(DEFAULT_COUNTRY);
    setCustomValues({});
    setShowForm(false);
  }

  async function changeStatus(id: string, status: LeadStatus) {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) {
      setError(error.message);
      setLeads(prev);
    }
  }

  async function convertLead(id: string) {
    setError(null);
    setBusy(true);
    const { data, error } = await supabase.rpc("convert_lead", { lead_id: id });
    setBusy(false);
    if (error) return setError(error.message);
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status: "converted" } : l)));
    // Invalidate cached Contacts/Accounts/Deals pages so the new records show,
    // then open the freshly created deal (also confirms the conversion worked).
    router.refresh();
    const dealId = (data as { deal_id?: string } | null)?.deal_id;
    if (dealId) router.push(`/deals/${dealId}`);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(true);
    setError(null);
    const { error } = await supabase
      .from("leads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setDeleting(false);
    setPendingDelete(null);
    if (error) return setError(error.message);
    setLeads((ls) => ls.filter((l) => l.id !== id));
  }

  const visible = view === "mine" ? leads.filter((l) => l.owner_id === userId) : leads;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Leads</h1>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button
              onClick={() => setView("mine")}
              className={`rounded-md px-2 py-1 font-medium ${
                view === "mine" ? "bg-brand text-white" : "text-slate-600"
              }`}
            >
              My leads
            </button>
            <button
              onClick={() => setView("all")}
              className={`rounded-md px-2 py-1 font-medium ${
                view === "all" ? "bg-brand text-white" : "text-slate-600"
              }`}
            >
              All
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Add lead
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={createLead}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3"
        >
          {(
            [
              ["first_name", "First name"],
              ["last_name", "Last name"],
              ["company", "Company"],
              ["website", "Website"],
              ["industry", "Industry"],
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              placeholder={label}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          ))}
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="sm:col-span-2">
            <PhoneInput
              country={phoneCountry}
              onCountry={setPhoneCountry}
              value={form.phone}
              onValue={(digits) => setForm({ ...form, phone: digits })}
            />
          </div>
          <input
            placeholder="Source"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
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
              {busy ? "Saving…" : "Save lead"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {view === "mine"
                    ? "No leads owned by you yet."
                    : "No leads yet — click “Add lead” to capture your first prospect."}
                </td>
              </tr>
            )}
            {visible.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  <Link href={`/leads/${l.id}`} className="hover:text-brand hover:underline">
                    {leadName(l)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{l.company ?? "—"}</td>
                <td className="px-4 py-3">
                  <select
                    value={l.status}
                    disabled={l.status === "converted"}
                    onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)}
                    className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLES[l.status]} disabled:opacity-70`}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-600">{l.score}</td>
                <td className="px-4 py-3 text-slate-600">{l.email ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {l.status === "qualified" && (
                      <button
                        onClick={() => convertLead(l.id)}
                        disabled={busy}
                        className="rounded-lg border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                      >
                        Convert
                      </button>
                    )}
                    {l.status === "converted" && (
                      <span className="text-xs text-green-700">✓ Converted</span>
                    )}
                    <button
                      onClick={() => setPendingDelete(l)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this lead?"
          message={`“${leadName(pendingDelete)}” will be removed. This can be restored from the database if needed.`}
          confirmLabel="Delete lead"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
