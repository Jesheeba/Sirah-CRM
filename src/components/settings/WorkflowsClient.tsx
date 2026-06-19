"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ENTITY_LABEL,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
} from "@/lib/workflows";
import {
  ENTITY_TYPES,
  type EntityType,
  type TriggerType,
  type Workflow,
} from "@/lib/types";

export default function WorkflowsClient({ initial }: { initial: Workflow[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState<Workflow[]>(initial);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [entity, setEntity] = useState<EntityType>("leads");
  const [triggerType, setTriggerType] = useState<TriggerType>("record_updated");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter a workflow name.");

    setBusy(true);
    // Created inactive so you can assemble triggers/conditions/actions before it fires.
    const { data: wf, error } = await supabase
      .from("workflows")
      .insert({ name: name.trim(), entity_type: entity, is_active: false })
      .select("id")
      .single();
    if (error || !wf) {
      setBusy(false);
      return setError(error?.message ?? "Could not create workflow.");
    }
    // Seed its first trigger so the editor opens ready to configure.
    const { error: tErr } = await supabase
      .from("workflow_triggers")
      .insert({ workflow_id: (wf as { id: string }).id, trigger_type: triggerType, config: {} });
    setBusy(false);
    if (tErr) return setError(tErr.message);
    router.push(`/settings/workflows/${(wf as { id: string }).id}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{rows.length} workflow(s)</span>
        <button
          onClick={() => setShow((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + New workflow
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {show && (
        <form
          onSubmit={create}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4"
        >
          <input
            placeholder="Workflow name (e.g. Hot lead alert)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value as EntityType)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {ENTITY_LABEL[et]}
              </option>
            ))}
          </select>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="sm:col-span-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create & configure"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Runs on</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                  No workflows yet — create your first automation.
                </td>
              </tr>
            )}
            {rows.map((w) => (
              <tr key={w.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/settings/workflows/${w.id}`} className="text-brand hover:underline">
                    {w.name}
                  </Link>
                </td>
                <td className="px-4 py-3 capitalize text-slate-600">{w.entity_type}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      w.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {w.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
