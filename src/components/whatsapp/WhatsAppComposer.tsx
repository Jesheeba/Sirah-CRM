"use client";

import { useMemo, useState } from "react";
import { mergeTemplate } from "@/lib/email";
import type { CommRelatedType, EmailTemplate } from "@/lib/types";
import { sendWhatsApp } from "@/app/(app)/whatsapp/actions";

export interface WaPrefill {
  to?: string;
  toName?: string;
  body?: string;
  related_to_type?: CommRelatedType | null;
  related_to_id?: string | null;
  quotation_id?: string | null;
  vars?: Record<string, string | number | null | undefined>;
}

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

export default function WhatsAppComposer({
  templates,
  providerEnabled,
  prefill,
  onClose,
  onSent,
}: {
  templates: EmailTemplate[];
  providerEnabled: boolean;
  prefill?: WaPrefill;
  onClose: () => void;
  onSent: () => void;
}) {
  const vars = useMemo(
    () => ({ to_name: prefill?.toName ?? "", ...(prefill?.vars ?? {}) }),
    [prefill]
  );

  const [to, setTo] = useState(prefill?.to ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setBody(mergeTemplate(t.body, vars));
  }

  async function submit() {
    if (!to.trim()) return setError("A phone number is required.");
    if (!body.trim()) return setError("Message is required.");
    setBusy(true);
    setError(null);
    const res = await sendWhatsApp({
      to_phone: to,
      to_name: prefill?.toName ?? null,
      body,
      template_id: templateId || null,
      related_to_type: prefill?.related_to_type ?? null,
      related_to_id: prefill?.related_to_id ?? null,
      quotation_id: prefill?.quotation_id ?? null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Send failed.");
    if (res.waUrl) window.open(res.waUrl, "_blank", "noopener");
    onSent();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="mt-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">New WhatsApp message</h2>
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
            <label className={LABEL}>To (phone)</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+91 98765 43210" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Message</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={INPUT} />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {providerEnabled ? "Sends via WhatsApp Cloud API + tracks receipts." : "Opens WhatsApp; logged to the timeline."}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? "Sending…" : providerEnabled ? "Send" : "Open in WhatsApp"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
