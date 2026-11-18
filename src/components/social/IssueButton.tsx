"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createIssueFromInteraction } from "@/app/(app)/social/actions";

/** "Add to Leads" (or the tenant's own label, e.g. "Issues") for a social-desk item; links to the lead once created. */
export default function IssueButton({ interactionId, leadId, label }: { interactionId: string; leadId: string | null; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (leadId) {
    return (
      <Link href={`/leads/${leadId}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
        Open in {label} →
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await createIssueFromInteraction(interactionId);
          setBusy(false);
          if (!r.ok) return setError(r.error ?? "Could not add it.");
          setNote(r.how === "attached" ? "Added to this person's existing record." : null);
          router.refresh();
        }}
        disabled={busy}
        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Adding…" : `Add to ${label}`}
      </button>
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      {note && <span role="status" className="text-sm text-green-700">{note}</span>}
    </div>
  );
}
