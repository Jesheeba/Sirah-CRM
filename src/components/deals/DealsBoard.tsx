"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import CustomFieldInputs from "@/components/record/CustomFieldInputs";
import { cleanCustomValues, firstRequiredMissing } from "@/lib/customFields";
import type { CustomFieldDef, Deal, DealStatus, Pipeline, Stage } from "@/lib/types";

interface MemberOption {
  id: string;
  name: string;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

// ── Lost Reason Modal ────────────────────────────────────────────────────────

function LostReasonModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h2 className="mb-1 text-base font-semibold text-slate-800">Why is this deal lost?</h2>
        <p className="mb-4 text-sm text-slate-500">A reason is required to track why deals are lost.</p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Budget constraints, chose a competitor, bad timing…"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={!reason.trim()}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Mark Lost
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ deals, currency }: { deals: Deal[]; currency: string }) {
  const openDeals = deals.filter((d) => d.status === "open");
  const openValue = openDeals.reduce((s, d) => s + Number(d.amount), 0);
  const weightedValue = openDeals.reduce(
    (s, d) => s + (Number(d.amount) * (d.probability ?? 0)) / 100,
    0,
  );

  const now = new Date();
  const wonThisMonth = deals
    .filter((d) => {
      if (d.status !== "won" || !d.closed_at) return false;
      const c = new Date(d.closed_at);
      return c.getFullYear() === now.getFullYear() && c.getMonth() === now.getMonth();
    })
    .reduce((s, d) => s + Number(d.amount), 0);

  const cards = [
    { label: "Open Pipeline", value: money(openValue, currency), sub: `${openDeals.length} open deal${openDeals.length !== 1 ? "s" : ""}` },
    { label: "Weighted Value", value: money(weightedValue, currency), sub: "probability × amount" },
    { label: "Won This Month", value: money(wonThisMonth, currency), sub: now.toLocaleString("default", { month: "long", year: "numeric" }) },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{c.label}</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{c.value}</p>
          <p className="text-xs text-slate-400">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main Board ───────────────────────────────────────────────────────────────

export default function DealsBoard({
  pipelines,
  stages,
  initialDeals,
  userId,
  isManager,
  customFields,
  profiles,
}: {
  pipelines: Pipeline[];
  stages: Stage[];
  initialDeals: Deal[];
  userId: string;
  isManager: boolean;
  customFields: CustomFieldDef[];
  profiles: MemberOption[];
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
  const [statusFilter, setStatusFilter] = useState<"all" | DealStatus>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [lostTarget, setLostTarget] = useState<{ dealId: string; stageId: string } | null>(null);

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

  const dealsForPipeline = useMemo(
    () =>
      deals.filter((d) => {
        if (d.pipeline_id !== pipelineId) return false;
        if (statusFilter !== "all" && d.status !== statusFilter) return false;
        if (ownerFilter !== "all" && d.owner_id !== ownerFilter) return false;
        return true;
      }),
    [deals, pipelineId, statusFilter, ownerFilter],
  );

  const pipelineCurrency =
    deals.find((d) => d.pipeline_id === pipelineId)?.currency ?? "INR";

  // ── Move logic ─────────────────────────────────────────────────────────────

  async function doMoveDeal(dealId: string, toStageId: string, lostReason: string | null) {
    const stage = stages.find((s) => s.id === toStageId);
    const nextStatus: DealStatus = stage?.is_won ? "won" : stage?.is_lost ? "lost" : "open";
    const nextProbability = stage?.is_won ? 100 : stage?.is_lost ? 0 : (stage?.probability ?? 0);

    const prev = deals;
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId
          ? { ...d, stage_id: toStageId, status: nextStatus, probability: nextProbability }
          : d,
      ),
    );

    const { error: rpcError } = await supabase.rpc("move_deal_stage", {
      deal_id: dealId,
      to_stage_id: toStageId,
      p_lost_reason: lostReason,
    });

    if (rpcError) {
      setError(rpcError.message);
      setDeals(prev);
    }
  }

  function moveDeal(dealId: string, toStageId: string) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === toStageId) return;

    const stage = stages.find((s) => s.id === toStageId);
    if (stage?.is_lost) {
      setLostTarget({ dealId, stageId: toStageId });
      return;
    }

    void doMoveDeal(dealId, toStageId, null);
  }

  // ── Create deal ────────────────────────────────────────────────────────────

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return setError("Enter a deal name.");
    const firstStage = pipelineStages[0];
    if (!firstStage) return setError("This pipeline has no stages.");
    const missing = firstRequiredMissing(customFields, customValues);
    if (missing) return setError(`${missing} is required.`);

    setBusy(true);
    const { data, error: insertError } = await supabase
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
    if (insertError) return setError(insertError.message);
    setDeals((ds) => [data as Deal, ...ds]);
    setNewName("");
    setNewAmount("");
    setCustomValues({});
    setShowForm(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">Deals</h1>

          {pipelines.length > 1 && (
            <select
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | DealStatus)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>

          {isManager && profiles.length > 0 && (
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
            >
              <option value="all">All owners</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
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

      {/* Summary cards */}
      <SummaryCards
        deals={deals.filter((d) => d.pipeline_id === pipelineId)}
        currency={pipelineCurrency}
      />

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

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {pipelineStages.map((stage) => {
          const colDeals = dealsForPipeline.filter((d) => d.stage_id === stage.id);
          const openTotal = colDeals.filter((d) => d.status === "open").reduce((s, d) => s + Number(d.amount), 0);

          const headerColor = stage.is_won
            ? "text-green-700"
            : stage.is_lost
              ? "text-rose-600"
              : "text-slate-700";

          return (
            <div
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId && moveDeal(dragId, stage.id)}
              className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70"
            >
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-semibold ${headerColor}`}>{stage.name}</span>
                  {!stage.is_won && !stage.is_lost && (
                    <span className="text-xs text-slate-400">{stage.probability}%</span>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  {colDeals.length} · {money(openTotal, pipelineCurrency)}
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
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand">
                        {money(Number(d.amount), d.currency)}
                      </span>
                      {d.status === "open" && (
                        <span className="text-xs text-slate-400">{d.probability}%</span>
                      )}
                    </div>

                    {d.status === "lost" && d.lost_reason && (
                      <p
                        className="mt-1 truncate text-xs italic text-rose-500"
                        title={d.lost_reason}
                      >
                        {d.lost_reason}
                      </p>
                    )}

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
          <div className="text-sm text-slate-500">
            This pipeline has no stages.{" "}
            <Link href="/settings/pipelines" className="text-brand hover:underline">
              Manage pipelines →
            </Link>
          </div>
        )}
      </div>

      {/* Lost reason modal */}
      {lostTarget && (
        <LostReasonModal
          onConfirm={(reason) => {
            void doMoveDeal(lostTarget.dealId, lostTarget.stageId, reason);
            setLostTarget(null);
          }}
          onCancel={() => setLostTarget(null)}
        />
      )}
    </div>
  );
}
