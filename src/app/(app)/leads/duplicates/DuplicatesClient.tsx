"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { mergeLeads } from "./actions";
import type { Lead } from "@/lib/types";

function leadName(l: Lead) {
  const n = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();
  return n || l.company || "(no name)";
}

function GroupCard({
  matchType,
  leads,
  onMerged,
}: {
  matchType: string;
  leads: Lead[];
  onMerged: (mergedIds: string[]) => void;
}) {
  const [primaryId, setPrimaryId] = useState(leads[0].id);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleMerge() {
    const duplicateIds = leads.filter((l) => l.id !== primaryId).map((l) => l.id);
    if (!confirm(`Merge ${duplicateIds.length} lead(s) into "${leadName(leads.find((l) => l.id === primaryId)!)}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await mergeLeads(primaryId, duplicateIds);
      if (!res.ok) { setError(res.error ?? "Failed"); return; }
      setDone(true);
      onMerged(duplicateIds);
    });
  }

  if (done) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Matched by {matchType}
      </p>
      <div className="space-y-1.5">
        {leads.map((l) => (
          <label key={l.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
            <input
              type="radio"
              name={`primary-${leads[0].id}`}
              checked={primaryId === l.id}
              onChange={() => setPrimaryId(l.id)}
            />
            <span className="flex-1 text-sm">
              <Link href={`/leads/${l.id}`} className="font-medium text-slate-800 hover:text-brand hover:underline">
                {leadName(l)}
              </Link>
              <span className="ml-2 text-slate-400">{l.email || l.phone}</span>
            </span>
            {primaryId === l.id && (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">Keep</span>
            )}
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={handleMerge}
        disabled={busy}
        className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Merging…" : `Merge into selected`}
      </button>
    </div>
  );
}

export default function DuplicatesClient({
  groups,
}: {
  groups: { key: string; matchType: string; leads: Lead[] }[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = groups.filter((g) => !g.leads.every((l) => dismissed.has(l.id)));

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        No potential duplicates found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((g) => (
        <GroupCard
          key={g.key}
          matchType={g.matchType}
          leads={g.leads}
          onMerged={(mergedIds) => setDismissed((d) => new Set([...d, ...mergedIds]))}
        />
      ))}
    </div>
  );
}
