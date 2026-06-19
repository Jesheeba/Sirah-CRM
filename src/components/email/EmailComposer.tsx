"use client";

import { useMemo, useState } from "react";
import { mergeTemplate } from "@/lib/email";
import type { CommRelatedType, EmailTemplate } from "@/lib/types";
import { sendEmail } from "@/app/(app)/email/actions";

export interface ComposerPrefill {
  to?: string;
  toName?: string;
  subject?: string;
  body?: string;
  related_to_type?: CommRelatedType | null;
  related_to_id?: string | null;
  quotation_id?: string | null;
  vars?: Record<string, string | number | null | undefined>;
}

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

export default function EmailComposer({
  templates,
  providerEnabled,
  prefill,
  onClose,
  onSent,
}: {
  templates: EmailTemplate[];
  providerEnabled: boolean;
  prefill?: ComposerPrefill;
  onClose: () => void;
  onSent: () => void;
}) {
  const vars = useMemo(
    () => ({ to_name: prefill?.toName ?? "", ...(prefill?.vars ?? {}) }),
    [prefill]
  );

  const [to, setTo] = useState(prefill?.to ?? "");
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(mergeTemplate(t.subject, vars));
    setBody(mergeTemplate(t.body, vars));
  }

  async function submit() {
    if (!to.trim()) return setError("Recipient email is required.");
    setBusy(true);
    setError(null);
    const res = await sendEmail({
      to_email: to,
      to_name: prefill?.toName ?? null,
      subject,
      body,
      template_id: templateId || null,
      related_to_type: prefill?.related_to_type ?? null,
      related_to_id: prefill?.related_to_id ?? null,
      quotation_id: prefill?.quotation_id ?? null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Send failed.");
    // No provider configured → open the user's mail client with the draft.
    if (res.mailto) window.location.href = res.mailto;
    onSent();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="mt-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">New email</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="space-y-3">
          {templates.length > 0 && (
            <div>
              <label className={LABEL}>Template</label>
              <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} className={INPUT}>
                <option value="">— Start blank —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={LABEL}>To</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={INPUT} />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {providerEnabled ? "Sends directly + tracks opens." : "Opens your mail client; logged to the timeline."}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? "Sending…" : providerEnabled ? "Send" : "Open in mail client"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
