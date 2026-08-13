"use client";

import { useMemo, useState } from "react";
import { mergeTemplate } from "@/lib/email";
import { extractVariables } from "@/lib/whatsapp-template-validator";
import type { SendTemplateComponent } from "@/lib/whatsapp-template-validator";
import type { CommRelatedType, EmailTemplate, WhatsAppTemplate } from "@/lib/types";
import { sendWhatsApp, sendTemplate } from "@/app/(app)/whatsapp/actions";

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

type MetaParamSlot = "header" | "body" | "button";

interface MetaParam {
  slot: MetaParamSlot;
  name: string;
  buttonIndex?: number;
}

function paramKey(p: Pick<MetaParam, "slot" | "name" | "buttonIndex">): string {
  return `${p.slot}:${p.buttonIndex ?? ""}:${p.name}`;
}

/** Every variable a Meta template needs filled at send time, in display order. */
function metaTemplateParams(template: WhatsAppTemplate): MetaParam[] {
  const params: MetaParam[] = [];
  for (const c of template.components) {
    if (c.type === "HEADER" && c.format === "TEXT" && c.text) {
      for (const name of extractVariables(c.text)) params.push({ slot: "header", name });
    } else if (c.type === "BODY") {
      for (const name of extractVariables(c.text)) params.push({ slot: "body", name });
    } else if (c.type === "BUTTONS") {
      c.buttons.forEach((b, i) => {
        if (b.type === "URL" && b.url) {
          for (const name of extractVariables(b.url)) params.push({ slot: "button", name, buttonIndex: i });
        }
      });
    }
  }
  return params;
}

function substitute(text: string, slot: MetaParamSlot, buttonIndex: number | undefined, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (m, name) => {
    const v = values[paramKey({ slot, name, buttonIndex })];
    return v?.trim() ? v : m;
  });
}

/** Builds the named-parameter `components` payload sendTemplate() sends to Meta. */
function buildSendComponents(template: WhatsAppTemplate, values: Record<string, string>): SendTemplateComponent[] {
  const out: SendTemplateComponent[] = [];
  for (const c of template.components) {
    if (c.type === "HEADER" && c.format === "TEXT" && c.text) {
      const vars = extractVariables(c.text);
      if (vars.length > 0) {
        out.push({
          type: "header",
          parameters: vars.map((name) => ({
            type: "text",
            parameter_name: name,
            text: values[paramKey({ slot: "header", name })] ?? "",
          })),
        });
      }
    } else if (c.type === "BODY") {
      const vars = extractVariables(c.text);
      if (vars.length > 0) {
        out.push({
          type: "body",
          parameters: vars.map((name) => ({
            type: "text",
            parameter_name: name,
            text: values[paramKey({ slot: "body", name })] ?? "",
          })),
        });
      }
    } else if (c.type === "BUTTONS") {
      c.buttons.forEach((b, i) => {
        if (b.type === "URL" && b.url) {
          const vars = extractVariables(b.url);
          if (vars.length > 0) {
            out.push({
              type: "button",
              sub_type: "url",
              index: String(i),
              parameters: vars.map((name) => ({
                type: "text",
                parameter_name: name,
                text: values[paramKey({ slot: "button", name, buttonIndex: i })] ?? "",
              })),
            });
          }
        }
      });
    }
  }
  return out;
}

export default function WhatsAppComposer({
  templates,
  metaTemplates,
  providerEnabled,
  prefill,
  onClose,
  onSent,
}: {
  templates: EmailTemplate[];
  metaTemplates: WhatsAppTemplate[];
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
  // "" = start blank, "snippet:<id>" = local quick-reply, "meta:<id>" = approved Meta template
  const [selection, setSelection] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMetaTemplate = selection.startsWith("meta:")
    ? metaTemplates.find((t) => t.id === selection.slice(5))
    : undefined;
  const metaParams = useMemo(
    () => (selectedMetaTemplate ? metaTemplateParams(selectedMetaTemplate) : []),
    [selectedMetaTemplate]
  );

  function handleSelect(value: string) {
    setSelection(value);
    setParamValues({});
    if (value.startsWith("snippet:")) {
      const t = templates.find((x) => x.id === value.slice(8));
      if (t) setBody(mergeTemplate(t.body, vars));
    } else if (!value) {
      setBody("");
    }
  }

  async function submit() {
    if (!to.trim()) return setError("A phone number is required.");

    if (selectedMetaTemplate) {
      const missing = metaParams.some((p) => !(paramValues[paramKey(p)] ?? "").trim());
      if (missing) return setError("Every template parameter needs a value.");
    } else if (!body.trim()) {
      return setError("Message is required.");
    }

    setBusy(true);
    setError(null);
    const res = selectedMetaTemplate
      ? await sendTemplate({
          to_phone: to,
          to_name: prefill?.toName ?? null,
          templateName: selectedMetaTemplate.name,
          languageCode: selectedMetaTemplate.language,
          components: buildSendComponents(selectedMetaTemplate, paramValues),
          related_to_type: prefill?.related_to_type ?? null,
          related_to_id: prefill?.related_to_id ?? null,
          quotation_id: prefill?.quotation_id ?? null,
        })
      : await sendWhatsApp({
          to_phone: to,
          to_name: prefill?.toName ?? null,
          body,
          template_id: selection.startsWith("snippet:") ? selection.slice(8) : null,
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

  const header = selectedMetaTemplate?.components.find((c) => c.type === "HEADER");
  const bodyComponent = selectedMetaTemplate?.components.find((c) => c.type === "BODY");
  const footer = selectedMetaTemplate?.components.find((c) => c.type === "FOOTER");

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
          {(metaTemplates.length > 0 || templates.length > 0) && (
            <div>
              <label className={LABEL}>Template</label>
              <select value={selection} onChange={(e) => handleSelect(e.target.value)} className={INPUT}>
                <option value="">— Start blank —</option>
                {metaTemplates.length > 0 && (
                  <optgroup label="Meta templates (approved)">
                    {metaTemplates.map((t) => (
                      <option key={t.id} value={`meta:${t.id}`}>
                        {t.name} ({t.language})
                      </option>
                    ))}
                  </optgroup>
                )}
                {templates.length > 0 && (
                  <optgroup label="Snippets">
                    {templates.map((t) => (
                      <option key={t.id} value={`snippet:${t.id}`}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {metaTemplates.length === 0 && (
                <p className="mt-1 text-[11px] text-slate-400">
                  No Meta-approved templates yet — create and submit one in Settings → WhatsApp Templates.
                </p>
              )}
            </div>
          )}
          <div>
            <label className={LABEL}>To (phone)</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+91 98765 43210" className={INPUT} />
          </div>

          {selectedMetaTemplate ? (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              {metaParams.length > 0 ? (
                <div className="space-y-2">
                  <p className={LABEL}>Parameters</p>
                  {metaParams.map((p) => (
                    <div key={paramKey(p)}>
                      <label className={LABEL}>{p.name}</label>
                      <input
                        value={paramValues[paramKey(p)] ?? ""}
                        onChange={(e) => setParamValues((v) => ({ ...v, [paramKey(p)]: e.target.value }))}
                        className={INPUT}
                        required
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">This template has no variables.</p>
              )}
              <div>
                <p className={LABEL}>Preview</p>
                <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {header?.type === "HEADER" && header.format === "TEXT" && header.text && (
                    <p className="font-semibold">{substitute(header.text, "header", undefined, paramValues)}</p>
                  )}
                  <p className="whitespace-pre-wrap">
                    {bodyComponent?.type === "BODY" ? substitute(bodyComponent.text, "body", undefined, paramValues) : ""}
                  </p>
                  {footer?.type === "FOOTER" && footer.text && (
                    <p className="mt-1 text-xs text-slate-500">{footer.text}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className={LABEL}>Message</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={INPUT} />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {selectedMetaTemplate
              ? "Meta template — required outside the 24h window."
              : providerEnabled
                ? "Sends via WhatsApp Cloud API + tracks receipts."
                : "Opens WhatsApp; logged to the timeline."}
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
