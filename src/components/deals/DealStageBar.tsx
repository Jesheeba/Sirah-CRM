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

export default function DealStageBar({
  dealId,
  stages,
  currentStageId,
  currentStatus,
  lostReason: initialLostReason,
}: {
  dealId: string;
  stages: Stage[];
  currentStageId: string;
  currentStatus: DealStatus;
  lostReason?: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [stageId, setStageId] = useState(currentStageId);
  const [status, setStatus] = useState<DealStatus>(currentStatus);
  const [lostReason, setLostReason] = useState(initialLostReason ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lostPending, setLostPending] = useState<string | null>(null);

  const ordered = [...stages].sort((a, b) => a.display_order - b.display_order);
  const currentIdx = ordered.findIndex((s) => s.id === stageId);
  const wonStage = ordered.find((s) => s.is_won);
  const lostStage = ordered.find((s) => s.is_lost);

  async function move(toId: string, reason?: string) {
    if (toId === stageId || busy) return;

    const targetStage = ordered.find((s) => s.id === toId);
    if (targetStage?.is_lost && !reason) {
      setLostPending(toId);
      return;
    }

    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("move_deal_stage", {
      deal_id: dealId,
      to_stage_id: toId,
      p_lost_reason: reason ?? null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const s = ordered.find((x) => x.id === toId);
    setStageId(toId);
    setStatus(s?.is_won ? "won" : s?.is_lost ? "lost" : "open");
    if (s?.is_lost && reason) setLostReason(reason);
    else if (!s?.is_lost) setLostReason(null);
    router.refresh();
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}
            >
              {status}
            </span>
            {status === "lost" && lostReason && (
              <span className="max-w-xs truncate text-xs italic text-slate-400" title={lostReason}>
                {lostReason}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {wonStage && status !== "won" && (
              <button
                onClick={() => move(wonStage.id)}
                disabled={busy}
                className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
              >
                Mark Won
              </button>
            )}
            {lostStage && status !== "lost" && (
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

      {lostPending && (
        <LostReasonModal
          onConfirm={(reason) => {
            void move(lostPending, reason);
            setLostPending(null);
          }}
          onCancel={() => setLostPending(null)}
        />
      )}
    </>
  );
}
