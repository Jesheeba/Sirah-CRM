"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrollLeadInSequence, stopSequenceEnrollment } from "@/app/(app)/leads/[id]/sequence-actions";
import type { SequenceEnrollment } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  stopped: "bg-slate-100 text-slate-500",
  completed: "bg-green-100 text-green-700",
};

export default function SequenceEnrollCard({
  leadId,
  availableSequences,
  enrollments,
}: {
  leadId: string;
  availableSequences: { id: string; name: string }[];
  enrollments: SequenceEnrollment[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(availableSequences[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeIds = new Set(enrollments.filter((e) => e.status === "active").map((e) => e.sequence_id));
  const enrollable = availableSequences.filter((s) => !activeIds.has(s.id));

  function handleEnroll() {
    if (!selected) return;
    startTransition(async () => {
      const res = await enrollLeadInSequence(leadId, selected);
      if (!res.ok) return setError(res.error ?? "Failed to enroll");
      setError(null);
      router.refresh();
    });
  }

  function handleStop(enrollmentId: string) {
    startTransition(async () => {
      await stopSequenceEnrollment(enrollmentId, leadId);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Sequences</h3>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {enrollments.length === 0 && (
        <p className="mb-2 px-2 text-sm text-slate-400">Not enrolled in any sequence.</p>
      )}

      <div className="space-y-1.5">
        {enrollments.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5">
            <div>
              <span className="text-sm text-slate-700">{e.sequences?.name ?? "Sequence"}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>
                {e.status}
              </span>
              {e.stop_reason && <p className="text-xs text-slate-400">{e.stop_reason}</p>}
            </div>
            {e.status === "active" && (
              <button
                onClick={() => handleStop(e.id)}
                disabled={pending}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Stop
              </button>
            )}
          </div>
        ))}
      </div>

      {enrollable.length > 0 ? (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            {enrollable.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={handleEnroll}
            disabled={pending}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "…" : "Enroll"}
          </button>
        </div>
      ) : (
        availableSequences.length === 0 && (
          <p className="mt-2 text-xs text-slate-400">No active sequences configured yet.</p>
        )
      )}
    </div>
  );
}
