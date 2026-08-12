"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  deleteTemplate,
  editSubmittedTemplate,
  saveDraftTemplate,
  submitTemplate,
  syncTemplates,
} from "@/app/(app)/settings/whatsapp-templates/actions";
import {
  TEMPLATE_CATEGORIES,
  extractVariables,
  validateTemplate,
  type TemplateButton,
  type TemplateCategory,
  type TemplateComponent,
} from "@/lib/whatsapp-template-validator";
import type { WhatsAppTemplate, WhatsAppTemplateStatus } from "@/lib/types";

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en_US", label: "English (US)" },
  { value: "en_GB", label: "English (UK)" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "es_MX", label: "Spanish (Mexico)" },
  { value: "pt_BR", label: "Portuguese (Brazil)" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "nl", label: "Dutch" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "vi", label: "Vietnamese" },
  { value: "zh_CN", label: "Chinese (Simplified)" },
  { value: "zh_TW", label: "Chinese (Traditional)" },
];

const STATUS_STYLES: Record<WhatsAppTemplateStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  PAUSED: "bg-orange-100 text-orange-700",
  DISABLED: "bg-red-100 text-red-700",
};

type HeaderFormat = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

interface FormState {
  id?: string;
  name: string;
  language: string;
  category: TemplateCategory | "";
  headerFormat: HeaderFormat;
  headerText: string;
  headerExample: string;
  bodyText: string;
  bodyExamples: string[];
  footerText: string;
  buttons: TemplateButton[];
}

const BLANK: FormState = {
  name: "",
  language: "en_US",
  category: "",
  headerFormat: "NONE",
  headerText: "",
  headerExample: "",
  bodyText: "",
  bodyExamples: [],
  footerText: "",
  buttons: [],
};

function buildComponents(form: FormState): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (form.headerFormat === "TEXT" && form.headerText.trim()) {
    const vars = extractVariables(form.headerText);
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: form.headerText.trim(),
      ...(vars.length > 0 && form.headerExample.trim()
        ? { example: { header_text: [form.headerExample.trim()] } }
        : {}),
    });
  } else if (form.headerFormat !== "NONE" && form.headerFormat !== "TEXT") {
    components.push({ type: "HEADER", format: form.headerFormat });
  }

  const bodyVars = extractVariables(form.bodyText);
  components.push({
    type: "BODY",
    text: form.bodyText,
    ...(bodyVars.length > 0
      ? { example: { body_text: [bodyVars.map((_, i) => form.bodyExamples[i] ?? "")] } }
      : {}),
  });

  if (form.footerText.trim()) {
    components.push({ type: "FOOTER", text: form.footerText.trim() });
  }

  if (form.buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: form.buttons });
  }

  return components;
}

function parseComponents(components: TemplateComponent[]): Partial<FormState> {
  const header = components.find((c): c is Extract<TemplateComponent, { type: "HEADER" }> => c.type === "HEADER");
  const body = components.find((c): c is Extract<TemplateComponent, { type: "BODY" }> => c.type === "BODY");
  const footer = components.find((c): c is Extract<TemplateComponent, { type: "FOOTER" }> => c.type === "FOOTER");
  const buttons = components.find((c): c is Extract<TemplateComponent, { type: "BUTTONS" }> => c.type === "BUTTONS");

  return {
    headerFormat: (header?.format as HeaderFormat) ?? "NONE",
    headerText: header?.format === "TEXT" ? header.text ?? "" : "",
    headerExample: header?.example?.header_text?.[0] ?? "",
    bodyText: body?.text ?? "",
    bodyExamples: body?.example?.body_text?.[0] ?? [],
    footerText: footer?.text ?? "",
    buttons: buttons?.buttons ?? [],
  };
}

export default function WhatsAppTemplatesClient({
  initial,
  wabaConnected,
}: {
  initial: WhatsAppTemplate[];
  wabaConnected: boolean;
}) {
  const [rows, setRows] = useState<WhatsAppTemplate[]>(initial);
  const [form, setForm] = useState<FormState>({ ...BLANK });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editingRow = form.id ? rows.find((r) => r.id === form.id) : undefined;
  const isSubmittedEdit = Boolean(editingRow && editingRow.status !== "DRAFT");

  const bodyVars = useMemo(() => extractVariables(form.bodyText), [form.bodyText]);
  const headerVars = useMemo(
    () => (form.headerFormat === "TEXT" ? extractVariables(form.headerText) : []),
    [form.headerFormat, form.headerText],
  );
  const components = useMemo(() => buildComponents(form), [form]);
  const liveCheck = useMemo(
    () => validateTemplate({ name: form.name, language: form.language, category: form.category, components }),
    [form.name, form.language, form.category, components],
  );

  function reset() {
    setForm({ ...BLANK });
    setEditing(true);
    setError(null);
  }

  function edit(t: WhatsAppTemplate) {
    const parsed = parseComponents(t.components);
    setForm({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category as TemplateCategory,
      headerFormat: "NONE",
      headerText: "",
      headerExample: "",
      bodyText: "",
      bodyExamples: [],
      footerText: "",
      buttons: [],
      ...parsed,
    });
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setEditing(false);
    setForm({ ...BLANK });
    setError(null);
  }

  async function saveDraft() {
    setError(null);
    setBusy("save");
    const res = await saveDraftTemplate({
      id: form.id,
      name: form.name.trim(),
      language: form.language,
      category: form.category,
      components,
    });
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Could not save draft.");
    if (res.template) {
      setRows((r) => {
        const exists = r.some((x) => x.id === res.template!.id);
        return exists ? r.map((x) => (x.id === res.template!.id ? res.template! : x)) : [res.template!, ...r];
      });
      setForm((f) => ({ ...f, id: res.template!.id }));
    }
  }

  async function submit() {
    if (!form.id) {
      await saveDraft();
    }
    const id = form.id;
    if (!id) return; // saveDraft failed — error already shown
    setError(null);
    setBusy("submit");
    const res = await submitTemplate(id);
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Submission failed.");
    if (res.template) setRows((r) => r.map((x) => (x.id === res.template!.id ? res.template! : x)));
    cancel();
  }

  async function saveEditOfSubmitted() {
    if (!form.id) return;
    setError(null);
    setBusy("edit");
    const res = await editSubmittedTemplate({ id: form.id, category: form.category, components });
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Edit failed.");
    if (res.template) setRows((r) => r.map((x) => (x.id === res.template!.id ? res.template! : x)));
    cancel();
  }

  async function remove(id: string) {
    if (!confirm("Delete this template? If it's been submitted, this also deletes it on WhatsApp.")) return;
    setBusy(`delete:${id}`);
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    const res = await deleteTemplate(id);
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Delete failed.");
      setRows(prev);
    }
  }

  async function sync() {
    setBusy("sync");
    setError(null);
    const res = await syncTemplates();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Sync failed.");
    window.location.reload();
  }

  function updateButton(i: number, patch: Partial<TemplateButton>) {
    setForm((f) => ({ ...f, buttons: f.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) }));
  }
  function addButton() {
    if (form.buttons.length >= 3) return;
    setForm((f) => ({ ...f, buttons: [...f.buttons, { type: "QUICK_REPLY", text: "" }] }));
  }
  function removeButton(i: number) {
    setForm((f) => ({ ...f, buttons: f.buttons.filter((_, idx) => idx !== i) }));
  }

  if (!wabaConnected) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-800">WhatsApp Templates</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Connect the official WhatsApp Cloud API with a Business Account in{" "}
          <Link href="/settings/integrations" className="font-medium underline">
            Settings → Integrations
          </Link>{" "}
          before creating templates.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">WhatsApp Templates</h1>
          <p className="text-sm text-slate-500">
            Meta-approved message templates for business-initiated conversations. Distinct from the quick-reply{" "}
            <Link href="/whatsapp/templates" className="underline">
              WhatsApp snippets
            </Link>{" "}
            used inside the inbox.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={sync}
            disabled={busy === "sync"}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "sync" ? "Syncing…" : "Sync status"}
          </button>
          {!editing && (
            <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              + New template
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {editing && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <form
            onSubmit={(e) => e.preventDefault()}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={LABEL}>Name</label>
                <input
                  value={form.name}
                  disabled={isSubmittedEdit}
                  onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  placeholder="order_confirmation"
                  className={INPUT + (isSubmittedEdit ? " bg-slate-50 text-slate-400" : "")}
                />
                <p className="mt-1 text-[11px] text-slate-400">lowercase letters, numbers, underscores only</p>
              </div>
              <div>
                <label className={LABEL}>Language</label>
                <select
                  value={form.language}
                  disabled={isSubmittedEdit}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className={INPUT + (isSubmittedEdit ? " bg-slate-50 text-slate-400" : "")}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label} ({l.value})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as TemplateCategory })}
                  className={INPUT}
                >
                  <option value="">Select…</option>
                  {TEMPLATE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {form.category && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {TEMPLATE_CATEGORIES.find((c) => c.value === form.category)?.costNote}
              </p>
            )}

            <div>
              <label className={LABEL}>Header (optional)</label>
              <select
                value={form.headerFormat}
                onChange={(e) => setForm({ ...form, headerFormat: e.target.value as HeaderFormat })}
                className={INPUT}
              >
                <option value="NONE">None</option>
                <option value="TEXT">Text</option>
                <option value="IMAGE">Image</option>
                <option value="VIDEO">Video</option>
                <option value="DOCUMENT">Document</option>
              </select>
              {form.headerFormat === "TEXT" && (
                <div className="mt-2 space-y-2">
                  <input
                    value={form.headerText}
                    onChange={(e) => setForm({ ...form, headerText: e.target.value })}
                    placeholder="Header text — at most one {{1}} variable"
                    className={INPUT}
                  />
                  {headerVars.length > 0 && (
                    <input
                      value={form.headerExample}
                      onChange={(e) => setForm({ ...form, headerExample: e.target.value })}
                      placeholder="Example value for {{1}}"
                      className={INPUT}
                    />
                  )}
                </div>
              )}
            </div>

            <div>
              <label className={LABEL}>Body</label>
              <textarea
                value={form.bodyText}
                onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
                rows={5}
                placeholder={"Hi {{1}}, your order {{2}} has shipped."}
                className={INPUT}
              />
              {bodyVars.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {bodyVars.map((v, i) => (
                    <input
                      key={v}
                      value={form.bodyExamples[i] ?? ""}
                      onChange={(e) => {
                        const next = [...form.bodyExamples];
                        next[i] = e.target.value;
                        setForm({ ...form, bodyExamples: next });
                      }}
                      placeholder={`Example for {{${v}}}`}
                      className={INPUT + " mt-0"}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={LABEL}>Footer (optional)</label>
              <input
                value={form.footerText}
                onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                placeholder="Reply STOP to opt out"
                className={INPUT}
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className={LABEL}>Buttons (optional, up to 3)</label>
                {form.buttons.length < 3 && (
                  <button type="button" onClick={addButton} className="text-xs font-medium text-brand hover:underline">
                    + Add button
                  </button>
                )}
              </div>
              <div className="mt-2 space-y-2">
                {form.buttons.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <select
                      value={b.type}
                      onChange={(e) => updateButton(i, { type: e.target.value as TemplateButton["type"] })}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      <option value="QUICK_REPLY">Quick reply</option>
                      <option value="URL">Website URL</option>
                      <option value="PHONE_NUMBER">Call phone number</option>
                    </select>
                    <input
                      value={b.text}
                      onChange={(e) => updateButton(i, { text: e.target.value })}
                      placeholder="Button label"
                      className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                    {b.type === "URL" && (
                      <input
                        value={b.url ?? ""}
                        onChange={(e) => updateButton(i, { url: e.target.value })}
                        placeholder="https://example.com/{{1}}"
                        className="min-w-[160px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      />
                    )}
                    {b.type === "URL" && extractVariables(b.url ?? "").length > 0 && (
                      <input
                        value={b.example?.[0] ?? ""}
                        onChange={(e) => updateButton(i, { example: [e.target.value] })}
                        placeholder="Example for {{1}}"
                        className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      />
                    )}
                    {b.type === "PHONE_NUMBER" && (
                      <input
                        value={b.phone_number ?? ""}
                        onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                        placeholder="+15551234567"
                        className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      />
                    )}
                    <button type="button" onClick={() => removeButton(i)} className="text-xs text-slate-400 hover:text-red-600">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {liveCheck.errors.length > 0 && (
              <ul className="list-disc space-y-1 rounded-lg bg-red-50 px-4 py-2 pl-8 text-xs text-red-700">
                {liveCheck.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {isSubmittedEdit ? (
                <button
                  type="button"
                  onClick={saveEditOfSubmitted}
                  disabled={busy !== null || !liveCheck.valid}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "edit" ? "Saving…" : "Save & resubmit"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={busy !== null || !liveCheck.valid}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy === "save" ? "Saving…" : "Save draft"}
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy !== null || !liveCheck.valid}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === "submit" ? "Submitting…" : "Submit for review"}
                  </button>
                </>
              )}
              <button type="button" onClick={cancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </form>

          <div className="space-y-2">
            <p className={LABEL}>Preview</p>
            <WhatsAppPreview
              headerFormat={form.headerFormat}
              headerText={form.headerText}
              headerExample={form.headerExample}
              bodyText={form.bodyText}
              bodyExamples={form.bodyExamples}
              footerText={form.footerText}
              buttons={form.buttons}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.length === 0 && !editing && <p className="text-sm text-slate-400">No templates yet.</p>}
        {rows.map((t) => (
          <div key={t.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-mono text-sm font-semibold text-slate-800">{t.name}</h3>
                <span className="text-xs text-slate-400">
                  {t.language} · {t.category}
                </span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[t.status]}`}>{t.status}</span>
            </div>
            {t.rejection_reason && (
              <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">{t.rejection_reason}</p>
            )}
            {t.quality_score && <p className="mt-1 text-[11px] text-slate-400">Quality: {t.quality_score}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => edit(t)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                Edit
              </button>
              <button
                onClick={() => remove(t.id)}
                disabled={busy === `delete:${t.id}`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fillVars(text: string, examples: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => examples[Number(n) - 1] || `{{${n}}}`);
}

function WhatsAppPreview({
  headerFormat,
  headerText,
  headerExample,
  bodyText,
  bodyExamples,
  footerText,
  buttons,
}: {
  headerFormat: HeaderFormat;
  headerText: string;
  headerExample: string;
  bodyText: string;
  bodyExamples: string[];
  footerText: string;
  buttons: TemplateButton[];
}) {
  return (
    <div className="rounded-xl bg-[#e5ddd5] p-4">
      <div className="max-w-[280px] rounded-lg bg-[#dcf8c6] p-3 shadow-sm">
        {headerFormat === "TEXT" && headerText && (
          <p className="mb-1 text-sm font-bold text-slate-800">{fillVars(headerText, [headerExample])}</p>
        )}
        {headerFormat !== "NONE" && headerFormat !== "TEXT" && (
          <div className="mb-2 flex h-24 items-center justify-center rounded bg-slate-200 text-xs text-slate-500">
            {headerFormat} attachment
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm text-slate-800">
          {bodyText ? fillVars(bodyText, bodyExamples) : <span className="text-slate-400">Body text…</span>}
        </p>
        {footerText && <p className="mt-1 text-xs text-slate-500">{footerText}</p>}
        {buttons.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-black/10 pt-2">
            {buttons.map((b, i) => (
              <div key={i} className="rounded bg-white/70 py-1 text-center text-xs font-medium text-sky-700">
                {b.text || "Button"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
