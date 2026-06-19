"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { TEMPLATE_VARIABLES } from "@/lib/email";
import type { CommChannel, EmailTemplate } from "@/lib/types";

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

const BLANK = { id: "", name: "", category: "", subject: "", body: "" };

/**
 * Shared message-template manager for any channel (email, WhatsApp, …).
 * Templates live in `email_templates`, partitioned by `channel`.
 */
export default function TemplatesClient({
  initial,
  canManage,
  channel,
  showSubject,
  title,
  backHref,
  backLabel,
}: {
  initial: EmailTemplate[];
  canManage: boolean;
  channel: CommChannel;
  showSubject: boolean;
  title: string;
  backHref: string;
  backLabel: string;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<EmailTemplate[]>(initial);
  const [form, setForm] = useState({ ...BLANK });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(t: EmailTemplate) {
    setForm({ id: t.id, name: t.name, category: t.category ?? "", subject: t.subject, body: t.body });
    setEditing(true);
  }
  function reset() {
    setForm({ ...BLANK });
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Template name is required.");
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      subject: showSubject ? form.subject : "",
      body: form.body,
    };
    if (form.id) {
      const { data, error } = await supabase
        .from("email_templates")
        .update(payload)
        .eq("id", form.id)
        .select("*")
        .single();
      setBusy(false);
      if (error) return setError(error.message);
      setRows((r) => r.map((x) => (x.id === form.id ? (data as EmailTemplate) : x)));
    } else {
      const { data, error } = await supabase
        .from("email_templates")
        .insert({ ...payload, channel })
        .select("*")
        .single();
      setBusy(false);
      if (error) return setError(error.message);
      setRows((r) => [data as EmailTemplate, ...r]);
    }
    setForm({ ...BLANK });
    setEditing(false);
  }

  async function remove(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    const { error } = await supabase
      .from("email_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setError(error.message);
      setRows(prev);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href={backHref} className="hover:underline">{backLabel}</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">Templates</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {canManage && !editing && (
          <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            + New template
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {canManage && editing && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Category</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Follow-up" className={INPUT} />
            </div>
          </div>
          {showSubject && (
            <div>
              <label className={LABEL}>Subject</label>
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={INPUT} />
            </div>
          )}
          <div>
            <label className={LABEL}>{showSubject ? "Body" : "Message"}</label>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={showSubject ? 8 : 5} className={INPUT} />
          </div>
          <div className="text-xs text-slate-400">
            Variables:{" "}
            {TEMPLATE_VARIABLES.map((v) => (
              <code key={v.key} className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-slate-500">{`{{${v.key}}}`}</code>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? "Saving…" : form.id ? "Update template" : "Save template"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm({ ...BLANK }); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.length === 0 && <p className="text-sm text-slate-400">No templates yet.</p>}
        {rows.map((t) => (
          <div key={t.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-800">{t.name}</h3>
                {t.category && <span className="text-xs text-slate-400">{t.category}</span>}
              </div>
            </div>
            {showSubject && (
              <p className="mt-2 text-sm font-medium text-slate-600">{t.subject || <span className="text-slate-300">No subject</span>}</p>
            )}
            <p className="mt-1 line-clamp-3 text-xs text-slate-500">{t.body}</p>
            {canManage && (
              <div className="mt-3 flex gap-2">
                <button onClick={() => edit(t)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Edit</button>
                <button onClick={() => remove(t.id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
