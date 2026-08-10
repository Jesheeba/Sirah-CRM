"use client";

import { useState, useTransition } from "react";
import { createRoutingRule, updateRoutingRule, deleteRoutingRule, type RuleInput } from "./actions";
import { ROUTING_LEAD_FIELDS, ROUTING_STRATEGIES, ROUTING_STRATEGY_LABELS, OPERATOR_LABELS } from "@/lib/routing";
import ConditionsEditor from "@/components/settings/ConditionsEditor";
import type { RoutingCondition, RoutingRule, RoutingStrategy, CustomFieldDef } from "@/lib/types";

interface MemberOption {
  id: string;
  name: string;
}

function fieldOptions(customFields: CustomFieldDef[]) {
  return [
    ...ROUTING_LEAD_FIELDS,
    ...customFields.map((f) => ({ key: `custom_fields.${f.field_key}`, label: f.label })),
  ];
}

// ── Rule form (shared by create + edit) ─────────────────────────────────────────

function RuleForm({
  initial,
  fields,
  members,
  busy,
  onSave,
  onCancel,
}: {
  initial: RuleInput;
  fields: { key: string; label: string }[];
  members: MemberOption[];
  busy: boolean;
  onSave: (data: RuleInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [priority, setPriority] = useState(initial.priority);
  const [conditions, setConditions] = useState<RoutingCondition[]>(initial.conditions);
  const [strategy, setStrategy] = useState<RoutingStrategy>(initial.strategy);
  const [targets, setTargets] = useState<string[]>(initial.target_user_ids);
  const [active, setActive] = useState(initial.is_active);

  function toggleTarget(id: string) {
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand/30 bg-brand/5 p-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rule name (e.g. Mumbai leads)"
          autoFocus
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          title="Lower runs first"
          className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      <ConditionsEditor conditions={conditions} fields={fields} onChange={setConditions} />

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Strategy
        </label>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as RoutingStrategy)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:w-auto"
        >
          {ROUTING_STRATEGIES.map((s) => (
            <option key={s} value={s}>{ROUTING_STRATEGY_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          {strategy === "specific" ? "Assign to (first checked)" : "Eligible reps"}
        </label>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                targets.includes(m.id) ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-600"
              }`}
            >
              <input
                type="checkbox"
                checked={targets.includes(m.id)}
                onChange={() => toggleTarget(m.id)}
                className="hidden"
              />
              {m.name}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded" />
        Active
      </label>

      <div className="flex gap-2">
        <button
          onClick={() => onSave({ name, priority, conditions, strategy, target_user_ids: targets, is_active: active })}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save rule"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Rule row (read view) ────────────────────────────────────────────────────────

function RuleRow({
  rule,
  fields,
  members,
  onUpdated,
  onDeleted,
}: {
  rule: RoutingRule;
  fields: { key: string; label: string }[];
  members: MemberOption[];
  onUpdated: (r: RoutingRule) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nameFor = (id: string) => members.find((m) => m.id === id)?.name ?? "Unknown";

  function handleSave(data: RuleInput) {
    startTransition(async () => {
      const res = await updateRoutingRule(rule.id, data);
      if (!res.ok) { setError(res.error ?? "Failed"); return; }
      onUpdated({ ...rule, ...data });
      setEditing(false);
      setError(null);
    });
  }

  function handleToggleActive() {
    startTransition(async () => {
      const res = await updateRoutingRule(rule.id, { is_active: !rule.is_active });
      if (res.ok) onUpdated({ ...rule, is_active: !rule.is_active });
    });
  }

  function handleDelete() {
    if (!confirm(`Delete routing rule "${rule.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteRoutingRule(rule.id);
      if (res.ok) onDeleted(rule.id);
      else setError(res.error ?? "Failed");
    });
  }

  if (editing) {
    return (
      <RuleForm
        initial={rule}
        fields={fields}
        members={members}
        busy={pending}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">#{rule.priority}</span>
        <span className="font-medium text-slate-800">{rule.name}</span>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
          {ROUTING_STRATEGY_LABELS[rule.strategy]}
        </span>
        {!rule.is_active && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Inactive</span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={handleToggleActive} disabled={pending} className="text-xs text-slate-500 hover:text-slate-700">
            {rule.is_active ? "Deactivate" : "Activate"}
          </button>
          <button onClick={() => setEditing(true)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            Edit
          </button>
          <button onClick={handleDelete} disabled={pending} className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
            Delete
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        {rule.conditions.length === 0
          ? "Matches every lead"
          : rule.conditions
              .map((c) => `${fields.find((f) => f.key === c.field)?.label ?? c.field} ${OPERATOR_LABELS[c.operator]}${c.operator === "is_empty" ? "" : ` "${c.value}"`}`)
              .join(" AND ")}
        {" · "}
        {rule.target_user_ids.length ? rule.target_user_ids.map(nameFor).join(", ") : "no reps selected"}
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────────

const NEW_RULE: RuleInput = {
  name: "",
  priority: 0,
  conditions: [],
  strategy: "round_robin",
  target_user_ids: [],
  is_active: true,
};

export default function RoutingClient({
  initialRules,
  members,
  customFields,
}: {
  initialRules: RoutingRule[];
  members: MemberOption[];
  customFields: CustomFieldDef[];
}) {
  const [rules, setRules] = useState<RoutingRule[]>(
    [...initialRules].sort((a, b) => a.priority - b.priority),
  );
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = fieldOptions(customFields);

  function handleCreate(data: RuleInput) {
    setBusy(true);
    createRoutingRule(data).then((res) => {
      setBusy(false);
      if (!res.ok || !res.rule) return setError(res.error ?? "Failed");
      setRules((rs) => [...rs, res.rule!].sort((a, b) => a.priority - b.priority));
      setAdding(false);
      setError(null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        On lead creation (manual, import, Meta Lead Ads, or web-to-lead), the first active rule whose
        conditions match assigns the owner. Rules run in priority order (lowest first). A lead that
        matches nothing stays unassigned unless you add a catch-all rule with no conditions.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {rules.length === 0 && !adding && (
        <p className="text-sm text-slate-400">No routing rules yet. Leads are left unassigned until you add one.</p>
      )}

      {rules.map((r) => (
        <RuleRow
          key={r.id}
          rule={r}
          fields={fields}
          members={members}
          onUpdated={(updated) => setRules((rs) => rs.map((x) => (x.id === updated.id ? updated : x)).sort((a, b) => a.priority - b.priority))}
          onDeleted={(id) => setRules((rs) => rs.filter((x) => x.id !== id))}
        />
      ))}

      {adding ? (
        <RuleForm
          initial={{ ...NEW_RULE, priority: rules.length }}
          fields={fields}
          members={members}
          busy={busy}
          onSave={handleCreate}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand"
        >
          + New routing rule
        </button>
      )}
    </div>
  );
}
