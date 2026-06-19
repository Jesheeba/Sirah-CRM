"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "email" | "url" | "number" | "date" | "tel" | "select";
  options?: string[];
  // When true, the value lives inside the row's `custom_fields` JSONB blob
  // rather than a flat column. Set by metadata-driven custom fields.
  custom?: boolean;
};

export default function EditableFields({
  table,
  id,
  fields,
  initial,
}: {
  table: string;
  id: string;
  fields: FieldDef[];
  // Widened to `any` because custom values live nested under `custom_fields`
  // and standard columns can be non-string (number/date).
  initial: Record<string, any>;
}) {
  const supabase = createClient();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      fields.map((f) => {
        const raw = f.custom ? (initial.custom_fields ?? {})[f.key] : initial[f.key];
        return [f.key, raw == null ? "" : String(raw)];
      }),
    ),
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    // Standard columns go in the flat patch; custom fields merge into the
    // existing custom_fields JSONB so untouched keys are preserved.
    const patch: Record<string, any> = {};
    const custom: Record<string, string> = { ...(initial.custom_fields ?? {}) };
    let hasCustom = false;
    for (const f of fields) {
      const v = values[f.key]?.trim() || null;
      if (f.custom) {
        hasCustom = true;
        if (v == null) delete custom[f.key];
        else custom[f.key] = v;
      } else {
        patch[f.key] = v;
      }
    }
    if (hasCustom) patch.custom_fields = custom;
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    setBusy(false);
    if (error) return setError(error.message);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Details</h2>
        {editing ? (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-slate-500 hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-brand hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <dl className="space-y-3">
        {fields.map((f) => (
          <div key={f.key}>
            <dt className="text-xs uppercase tracking-wide text-slate-400">{f.label}</dt>
            {editing && f.type === "select" ? (
              <select
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm capitalize outline-none focus:border-brand"
              >
                <option value="">—</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : editing ? (
              <input
                type={f.type ?? "text"}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
              />
            ) : (
              <dd className="mt-0.5 break-words text-sm text-slate-700">
                {values[f.key] || <span className="text-slate-300">—</span>}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
