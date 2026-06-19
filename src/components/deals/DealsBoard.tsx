"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import CustomFieldInputs from "@/components/record/CustomFieldInputs";
import { cleanCustomValues, firstRequiredMissing } from "@/lib/customFields";
import type { CustomFieldDef, Deal, Pipeline, Stage } from "@/lib/types";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export default function DealsBoard({
  pipelines,
  stages,
  initialDeals,
  userId,
  customFields,
}: {
  pipelines: Pipeline[];
  stages: Stage[];
  initialDeals: Deal[];
  userId: string;
  customFields: CustomFieldDef[];
}) {
  const supabase = createClient();
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const defaultPipeline =
    pipelines.find((p) => p.is_default)?.id ?? pipelines[0]?.id ?? "";
  const [pipelineId, setPipelineId] = useState(defaultPipeline);

  const pipelineStages = useMemo(
    () =>
      stages
        .filter((s) => s.pipeline_id === pipelineId)
        .sort((a, b) => a.display_order - b.display_order),
    [stages, pipelineId],
  );

  const dealsForPipeline = deals.filter((d) => d.pipeline_id === pipelineId);

  async function moveDeal(dealId: string, toStageId: string) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === toStageId) return;
    const stage = stages.find((s) => s.id === toStageId);
    const nextStatus = stage?.is_won ? "won" : stage?.is_lost ? "lost" : "open";

    const prev = deals;
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId ? { ...d, stage_id: toStageId, status: nextStatus } : d,
      ),
    );
    const { error } = await supabase.rpc("move_deal_stage", {
      deal_id: dealId,
      to_stage_id: toStageId,
    });
    if (error) {
      setError(error.message);
      setDeals(prev);
    }
  }

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return setError("Enter a deal name.");
    const firstStage = pipelineStages[0];
    if (!firstStage) return setError("This pipeline has no stages.");
    const missing = firstRequiredMissing(customFields, customValues);
    if (missing) return setError(`${missing} is required.`);

    setBusy(true);
    const { data, error } = await supabase
      .from("deals")
      .insert({
        name: newName.trim(),
        amount: Number(newAmount) || 0,
        pipeline_id: pipelineId,
        stage_id: firstStage.id,
        custom_fields: cleanCustomValues(customFields, customValues),
        owner_id: userId,
        created_by: userId,
      })
      .select("*, accounts(name)")
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setDeals((ds) => [data as Deal, ...ds]);
    setNewName("");
    setNewAmount("");
    setCustomValues({});
    setShowForm(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Deals</h1>
          {pipelines.length > 1 && (
            <select
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + New deal
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={createDeal}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row"
        >
          <input
            placeholder="Deal name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            placeholder="Amount"
            type="number"
            min={0}
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:w-40"
          />
          <CustomFieldInputs
            defs={customFields}
            values={customValues}
            onChange={(k, v) => setCustomValues((p) => ({ ...p, [k]: v }))}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add deal"}
          </button>
        </form>
      )}

      {/* Board: horizontal scroll on small screens (swipe between stages) */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {pipelineStages.map((stage) => {
          const colDeals = dealsForPipeline.filter((d) => d.stage_id === stage.id);
          const total = colDeals.reduce((sum, d) => sum + Number(d.amount), 0);
          const currency = colDeals[0]?.currency ?? "INR";
          return (
            <div
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId && moveDeal(dragId, stage.id)}
              className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70"
            >
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">{stage.name}</span>
                <span className="text-xs text-slate-500">
                  {colDeals.length} · {money(total, currency)}
                </span>
              </div>
              <div className="flex min-h-[80px] flex-1 flex-col gap-2 px-2 pb-3">
                {colDeals.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                    Drop a deal here
                  </div>
                )}
                {colDeals.map((d) => (
                  <div
                    key={d.id}
                    draggable
                    onDragStart={() => setDragId(d.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                  >
                    <Link
                      href={`/deals/${d.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium text-slate-800 hover:text-brand hover:underline"
                    >
                      {d.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {d.accounts?.name ?? "No account"}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-brand">
                      {money(Number(d.amount), d.currency)}
                    </div>
                    {/* Touch/mobile-friendly stage mover */}
                    <select
                      value={d.stage_id}
                      onChange={(e) => moveDeal(d.id, e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 outline-none focus:border-brand"
                    >
                      {pipelineStages.map((s) => (
                        <option key={s.id} value={s.id}>
                          Move to: {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {pipelineStages.length === 0 && (
          <div className="text-sm text-slate-500">This pipeline has no stages yet.</div>
        )}
      </div>
    </div>
  );
}
