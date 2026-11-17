"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CustomFieldInputs from "@/components/record/CustomFieldInputs";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PhoneInput from "@/components/ui/PhoneInput";
import { cleanCustomValues, firstRequiredMissing } from "@/lib/customFields";
import { DEFAULT_COUNTRY, isValidNationalNumber, toInternational } from "@/lib/countries";
import { isValidEmail } from "@/lib/validation";
import { LEADS_PAGE_SIZE, leadsHref, type LeadsQuery } from "@/lib/leads-list";
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
  total,
  query,
  formNames,
  adNames,
  userId,
  defaultMine,
  customFields,
}: {
  initialLeads: Lead[];
  total: number;
  query: LeadsQuery;
  formNames: string[];
  adNames: string[];
  userId: string;
  defaultMine: boolean;
  customFields: CustomFieldDef[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [search, setSearch] = useState(query.q);
  // A new page / filter arrives as fresh server props — show it, replacing local edits.
  useEffect(() => setLeads(initialLeads), [initialLeads]);
  useEffect(() => setSearch(query.q), [query.q]);
  const { view, form: formFilter, ad: adFilter, sort } = query;
  const go = (over: Partial<LeadsQuery>) =>
    startNav(() => router.push(leadsHref(query, defaultMine, { page: 1, ...over })));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dupWarning, setDupWarning] = useState<Lead[] | null>(null);

  async function doCreate() {
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
    setDupWarning(null);
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDupWarning(null);

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

    // Warn (don't block) on a likely duplicate — same email or phone as an existing lead.
    const { data: possibleDupes } = await supabase.rpc("fn_find_duplicate_leads", {
      p_email: form.email.trim() || null,
      p_phone: toInternational(phoneCountry, form.phone) || null,
    });
    if (possibleDupes && (possibleDupes as Lead[]).length > 0) {
      setDupWarning(possibleDupes as Lead[]);
      return;
    }

    await doCreate();
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

  const cfOf = (l: Lead, key: string) => {
    const v = (l.custom_fields as Record<string, unknown> | null)?.[key];
    return typeof v === "string" ? v : "";
  };
  // Fall back to the ad id so leads whose ad name Meta withheld are still groupable.
  const adOf = (l: Lead) => cfOf(l, "fb_ad_name") || cfOf(l, "fb_ad_id");
  const visible = leads;
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (query.page - 1) * LEADS_PAGE_SIZE + 1;
  const lastRow = Math.min(total, firstRow + visible.length - 1);

  function toggleScoreSort() {
    go({ sort: sort === "newest" ? "score_desc" : sort === "score_desc" ? "score_asc" : "newest" });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Leads</h1>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button
              onClick={() => go({ view: "mine" })}
              className={`rounded-md px-2 py-1 font-medium ${
                view === "mine" ? "bg-brand text-white" : "text-slate-600"
              }`}
            >
              My leads
            </button>
            <button
              onClick={() => go({ view: "all" })}
              className={`rounded-md px-2 py-1 font-medium ${
                view === "all" ? "bg-brand text-white" : "text-slate-600"
              }`}
            >
              All
            </button>
          </div>
          {formNames.length > 0 && (
            <select
              value={formFilter}
              onChange={(e) => go({ form: e.target.value })}
              aria-label="Filter by ad form"
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
            >
              <option value="">All ad forms</option>
              {formNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {adNames.length > 0 && (
            <select
              value={adFilter}
              onChange={(e) => go({ ad: e.target.value })}
              aria-label="Filter by ad"
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
            >
              <option value="">All ads</option>
              {adNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: search });
            }}
            role="search"
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone…"
              aria-label="Search leads"
              className="w-48 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand"
            />
          </form>
        </div>
        <div className="flex gap-2">
          <Link
            href="/leads/duplicates"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Review duplicates
          </Link>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Add lead
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {dupWarning && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">
            {dupWarning.length} possible duplicate{dupWarning.length > 1 ? "s" : ""} found:
          </p>
          <ul className="list-inside list-disc">
            {dupWarning.map((d) => (
              <li key={d.id}>
                {leadName(d)} — {d.email || d.phone}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={doCreate}
              disabled={busy}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create anyway"}
            </button>
            <button
              onClick={() => setDupWarning(null)}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
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
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">
                <button
                  onClick={toggleScoreSort}
                  className="flex items-center gap-1 uppercase tracking-wide text-slate-500 hover:text-brand"
                  title="Sort by score"
                >
                  Score
                  {sort === "score_desc" && <span>▼</span>}
                  {sort === "score_asc" && <span>▲</span>}
                </button>
              </th>
              <th className="px-4 py-3">Ad</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {query.q || formFilter || adFilter
                    ? "No leads match your search."
                    : view === "mine"
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
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex min-w-[2.25rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      l.score >= 50
                        ? "bg-emerald-100 text-emerald-700"
                        : l.score >= 20
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                    title="Lead score — see Settings → Lead Scoring for how it's calculated"
                  >
                    {l.score}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {adOf(l) ? (
                    <span
                      className="block max-w-[14rem] truncate"
                      title={[
                        cfOf(l, "fb_ad_name") && `Ad: ${cfOf(l, "fb_ad_name")}`,
                        cfOf(l, "fb_ad_id") && `Ad ID: ${cfOf(l, "fb_ad_id")}`,
                        cfOf(l, "fb_page_id") && `Page ID: ${cfOf(l, "fb_page_id")}`,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    >
                      {adOf(l)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
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

      <div className="flex items-center justify-between text-xs text-slate-500" aria-live="polite">
        <span>
          {navigating ? "Loading…" : total === 0 ? "0 leads" : `${firstRow}–${lastRow} of ${total}`}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => go({ page: query.page - 1 })}
              disabled={query.page <= 1 || navigating}
              className="rounded-lg border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span>
              Page {query.page} of {pages}
            </span>
            <button
              onClick={() => go({ page: query.page + 1 })}
              disabled={query.page >= pages || navigating}
              className="rounded-lg border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
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
