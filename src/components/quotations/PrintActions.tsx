"use client";

import Link from "next/link";

/** Toolbar shown on screen but hidden in the printed PDF. */
export default function PrintActions({ backHref }: { backHref: string }) {
  return (
    <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 print:hidden">
      <Link href={backHref} className="text-sm text-slate-600 hover:underline">
        ← Back to quotation
      </Link>
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}
