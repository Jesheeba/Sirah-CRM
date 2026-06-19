// Bare layout for printable documents — no sidebar/topbar, so the browser's
// "Save as PDF" produces a clean page. Auth is still enforced by middleware.
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 print:bg-white">{children}</div>;
}
