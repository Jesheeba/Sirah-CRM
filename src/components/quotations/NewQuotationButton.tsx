"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Creates a draft quotation (header only) and navigates to its editor where
 * line items are added. Reused on the Quotations list and on a Deal's detail
 * page (prefilled with the deal/account/contact).
 */
export default function NewQuotationButton({
  dealId,
  accountId,
  contactId,
  defaultTitle,
  label = "+ New quotation",
  className,
}: {
  dealId?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  defaultTitle?: string;
  label?: string;
  className?: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("quotations")
      .insert({
        title: defaultTitle?.trim() || "Quotation",
        deal_id: dealId || null,
        account_id: accountId || null,
        contact_id: contactId || null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    router.push(`/quotations/${data.id}`);
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={create}
        disabled={busy}
        className={
          className ??
          "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        }
      >
        {busy ? "Creating…" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
