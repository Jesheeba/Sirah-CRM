"use client";

export default function ReportPrintActions() {
  return (
    <div className="mb-3 flex justify-end print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}
