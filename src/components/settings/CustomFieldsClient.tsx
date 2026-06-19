"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { slugifyKey } from "@/lib/customFields";
import {
  CUSTOM_FIELD_TYPES,
  ENTITY_TYPES,
  type CustomFieldDef,
  type CustomFieldType,
  type EntityType,
} from "@/lib/types";

const ENTITY_LABEL: Record<EntityType, string> = {
  leads: "Leads",
  contacts: "Contacts",
  accounts: "Accounts",
  deals: "Deals",
};

export default function CustomFieldsClient({
  initialDefs,
}: {
  initialDefs: CustomFieldDef[];
}) {
  const supabase = createClient();
  const [defs, setDefs] = useState<CustomFieldDef[]>(initialDefs);
  const [entity, setEntity] = useState<EntityType>("leads");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-field form state.
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState<CustomFieldType>("text");
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");

  const rows = defs
    .filter((d) => d.entity_type === entity)
    .sort((a, b) => a.display_order - b.display_order);

  const previewKey = slugifyKey(label);

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const lbl = label.trim();
    if (!lbl) return setError("Enter a field label.");
    const key = slugifyKey(lbl);
    if (!key) return setError("Label must contain letters or numbers.");
    if (rows.some((d) => d.field_key === key)) {
      return setError(`A field with key “${key}” already exists for ${ENTITY_LABEL[entity]}.`);
    }

    let options: string[] | null = null;
    if (dataType === "select") {
      options = optionsText.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length === 0) return setError("Add at least one option for a dropdown field.");
    }

    const display_order = rows.length;
    setBusy(true);
    const { data, error } = await supabase
      .from("custom_field_definitions")
      .insert({
        entity_type: entity,
        field_key: key,
        label: lbl,
        data_type: dataType,
        options,
        is_required: required,
        display_order,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return setError(error.message);

    setDefs((ds) => [
      ...ds,
      {
        id: (data as { id: string }).id,
        entity_type: entity,
        field_key: key,
        label: lbl,
        data_type: dataType,
        options,
        is_required: required,
        display_order,
      },
    ]);
    setLabel("");
    setDataType("text");
    setRequired(false);
    setOptionsText("");
  }

  async function remove(id: string) {
    const prev = defs;
    setDefs((ds) => ds.filter((d) => d.id !== id));
    setError(null);
    const { error } = await supabase.from("custom_field_definitions").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setDefs(prev);
    }
  }

  return (
    <div className="space-y-4">
      {/* Entity tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {ENTITY_TYPES.map((et) => (
          <button
            key={et}
            onClick={() => {
              setEntity(et);
              setError(null);
            }}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              entity === et ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {ENTITY_LABEL[et]}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Existing fields */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Required</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No custom fields for {ENTITY_LABEL[entity]} yet — add one below.
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{d.label}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.field_key}</td>
                <td className="px-4 py-3 text-slate-600">
                  {d.data_type}
                  {d.data_type === "select" && d.options?.length ? (
                    <span className="text-slate-400"> · {d.options.join(", ")}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-600">{d.is_required ? "Yes" : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => remove(d.id)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add field */}
      <form
        onSubmit={addField}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-semibold text-slate-700">
          Add a field to {ENTITY_LABEL[entity]}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Segment"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
            {previewKey && (
              <p className="mt-1 text-xs text-slate-400">
                key: <span className="font-mono">{previewKey}</span>
              </p>
            )}
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Type</label>
            <select
              value={dataType}
              onChange={(e) => setDataType(e.target.value as CustomFieldType)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {dataType === "select" && (
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Options (comma-separated)
              </label>
              <input
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="SMB, Mid-Market, Enterprise"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Required
            </label>
          </div>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add field"}
        </button>
      </form>

      <p className="text-xs text-slate-400">
        Fields appear on record pages (editable inline) and in the “new record” form for{" "}
        {ENTITY_LABEL[entity]}. The key is generated from the label and can’t be changed after
        creation.
      </p>
    </div>
  );
}
