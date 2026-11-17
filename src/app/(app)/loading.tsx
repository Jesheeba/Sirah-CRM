// Shown instantly while any page in the app group fetches its data, so a click responds
// at once instead of freezing on the old screen until the server finishes.
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="h-7 w-40 animate-pulse rounded bg-slate-200" />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
            <div className="h-4 w-1/4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-1/5 animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-1/6 animate-pulse rounded bg-slate-100" />
            <div className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
