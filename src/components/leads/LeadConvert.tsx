"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LeadConvert({
  leadId,
  convertedDealId,
}: {
  leadId: string;
  convertedDealId: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (convertedDealId) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Converted</h3>
        <Link
          href={`/deals/${convertedDealId}`}
          className="block rounded-md px-2 py-1 text-sm text-brand hover:bg-slate-50"
        >
          💼 View resulting deal
        </Link>
      </div>
    );
  }

  async function convert() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("convert_lead", { lead_id: leadId });
    setBusy(false);
    if (error) return setError(error.message);
    const dealId = (data as { deal_id?: string } | null)?.deal_id;
    if (dealId) router.push(`/deals/${dealId}`);
    else router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Convert</h3>
      <p className="mb-2 text-xs text-slate-500">
        A <span className="font-medium">Qualified</span> lead converts into an account, contact, and deal.
      </p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={convert}
        disabled={busy}
        className="w-full rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
      >
        {busy ? "Converting…" : "Convert lead"}
      </button>
    </div>
  );
}
