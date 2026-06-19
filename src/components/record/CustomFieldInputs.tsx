"use client";

import type { CustomFieldDef } from "@/lib/types";

const INPUT =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

function htmlType(t: CustomFieldDef["data_type"]): string {
  switch (t) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "email":
      return "email";
    case "url":
      return "url";
    case "tel":
      return "tel";
    default:
      return "text";
  }
}

/**
 * One metadata-driven renderer for custom-field inputs, used by every create
 * form. Returns a fragment of bare inputs/selects so they flow as grid/flex
 * children inside the host form, matching the existing placeholder-only style.
 */
export default function CustomFieldInputs({
  defs,
  values,
  onChange,
}: {
  defs: CustomFieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {defs.map((d) => {
        const ph = d.is_required ? `${d.label} *` : d.label;
        if (d.data_type === "select") {
          return (
            <select
              key={d.id}
              value={values[d.field_key] ?? ""}
              onChange={(e) => onChange(d.field_key, e.target.value)}
              className={INPUT}
            >
              <option value="">— {ph} —</option>
              {(d.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        }
        return (
          <input
            key={d.id}
            type={htmlType(d.data_type)}
            placeholder={ph}
            value={values[d.field_key] ?? ""}
            onChange={(e) => onChange(d.field_key, e.target.value)}
            className={INPUT}
          />
        );
      })}
    </>
  );
}
