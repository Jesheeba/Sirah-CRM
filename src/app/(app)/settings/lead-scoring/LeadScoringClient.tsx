"use client";

import { useState, useTransition } from "react";
import { upsertLeadScoringRule } from "./actions";
import { LEAD_SCORING_ACTIONS } from "@/lib/lead-scoring";
import type { LeadScoringRule } from "@/lib/types";

function RuleRow({
  action,
  label,
  description,
  defaultPoints,
  wired,
  rule,
  onSaved,
}: {
  action: string;
  label: string;
  description: string;
  defaultPoints: number;
  wired: boolean;
  rule: LeadScoringRule | undefined;
  onSaved: (r: LeadScoringRule) => void;
}) {
  const [points, setPoints] = useState(rule?.points ?? defaultPoints);
  const [active, setActive] = useState(rule?.is_active ?? true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = points !== (rule?.points ?? defaultPoints) || active !== (rule?.is_active ?? true);

  function save() {
    startTransition(async () => {
      const res = await upsertLeadScoringRule(action, points, active);
      if (!res.ok) return setError(res.error ?? "Failed");
      setError(null);
      onSaved({ tenant_id: rule?.tenant_id ?? "", action, points, is_active: active, updated_at: new Date().toISOString() });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="min-w-[12rem] flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800">{label}</span>
          {!wired && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="No feature triggers this yet">
              not yet wired
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
      <input
        type="number"
        value={points}
        onChange={(e) => setPoints(Number(e.target.value))}
        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      <button
        onClick={() => setActive((a) => !a)}
        role="switch"
        aria-checked={active}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${active ? "bg-brand" : "bg-slate-300"}`}
        title={active ? "Enabled" : "Disabled"}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${active ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={save}
        disabled={!dirty || pending}
        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export default function LeadScoringClient({ initialRules }: { initialRules: LeadScoringRule[] }) {
  const [rules, setRules] = useState<LeadScoringRule[]>(initialRules);
  const byAction = new Map(rules.map((r) => [r.action, r]));

  return (
    <div className="space-y-2">
      {LEAD_SCORING_ACTIONS.map((a) => (
        <RuleRow
          key={a.action}
          action={a.action}
          label={a.label}
          description={a.description}
          defaultPoints={a.defaultPoints}
          wired={a.wired}
          rule={byAction.get(a.action)}
          onSaved={(r) => setRules((rs) => [...rs.filter((x) => x.action !== r.action), r])}
        />
      ))}
    </div>
  );
}
