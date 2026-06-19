"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { DealStatus, Stage } from "@/lib/types";

const STATUS_STYLE: Record<DealStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-rose-100 text-rose-700",
};

export default function DealStageBar({
  dealId,
  stages,
  currentStageId,
  currentStatus,
}: {
  dealId: string;
  stages: Stage[];
  currentStageId: string;
  currentStatus: DealStatus;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [stageId, setStageId] = useState(currentStageId);
  const [status, setStatus] = useState<DealStatus>(currentStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...stages].sort((a, b) => a.display_order - b.display_order);
  const currentIdx = ordered.findIndex((s) => s.id === stageId);
  const wonStage = ordered.find((s) => s.is_won);
  const lostStage = ordered.find((s) => s.is_lost);

  async function move(toId: string) {
    if (toId === stageId || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("move_deal_stage", {
      deal_id: dealId,
      to_stage_id: toId,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    const s = ordered.find((x) => x.id === toId);
    setStageId(toId);
    setStatus(s?.is_won ? "won" : s?.is_lost ? "lost" : "open");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}
        >
          {status}
        </span>
        <div className="flex gap-2">
          {wonStage && (
            <button
              onClick={() => move(wonStage.id)}
              disabled={busy}
              className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
            >
              Mark Won
            </button>
          )}
          {lostStage && (
            <button
              onClick={() => move(lostStage.id)}
              disabled={busy}
              className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              Mark Lost
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <div className="flex gap-1 overflow-x-auto">
        {ordered.map((s, i) => {
          const active = s.id === stageId;
          const passed = i < currentIdx;
          return (
            <button
              key={s.id}
              onClick={() => move(s.id)}
              disabled={busy}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50 ${
                active
                  ? "bg-brand text-white"
                  : passed
                    ? "bg-brand-50 text-brand"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
