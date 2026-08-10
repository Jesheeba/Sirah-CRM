"use client";

import { CONDITION_OPERATORS, OPERATOR_LABELS } from "@/lib/routing";
import type { RoutingCondition } from "@/lib/types";

/**
 * Shared {field, operator, value} condition-row builder — used by Lead Routing (#13)
 * and Bulk Email Campaign segments (#25), both of which reuse the same condition shape
 * and fn_eval_routing_condition() evaluator server-side. Keep this the single UI for
 * that shape rather than re-building the row editor a third time.
 */
export function emptyCondition(defaultField: string): RoutingCondition {
  return { field: defaultField, operator: "eq", value: "" };
}

export default function ConditionsEditor({
  conditions,
  fields,
  onChange,
  emptyLabel = "match every record",
}: {
  conditions: RoutingCondition[];
  fields: { key: string; label: string }[];
  onChange: (next: RoutingCondition[]) => void;
  emptyLabel?: string;
}) {
  function update(i: number, patch: Partial<RoutingCondition>) {
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function remove(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...conditions, emptyCondition(fields[0]?.key ?? "source")]);
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Conditions (all must match — leave empty to {emptyLabel})
      </label>
      {conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            value={c.field}
            onChange={(e) => update(i, { field: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            {fields.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select
            value={c.operator}
            onChange={(e) => update(i, { operator: e.target.value as RoutingCondition["operator"] })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            {CONDITION_OPERATORS.map((op) => (
              <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
            ))}
          </select>
          {c.operator !== "is_empty" && (
            <input
              value={c.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="value"
              className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          )}
          <button
            onClick={() => remove(i)}
            className="text-slate-300 hover:text-red-500"
            title="Remove condition"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand"
      >
        + Add condition
      </button>
    </div>
  );
}
