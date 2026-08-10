function ProgressRow({
  label,
  achieved,
  target,
  formatValue,
}: {
  label: string;
  achieved: number;
  target: number;
  formatValue: (n: number) => string;
}) {
  const ratio = target > 0 ? achieved / target : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const barColor = ratio >= 1 ? "bg-emerald-500" : ratio >= 0.6 ? "bg-brand" : "bg-amber-500";

  return (
    <div title={`${formatValue(achieved)} of ${formatValue(target)} (${Math.round(ratio * 100)}%)`}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium text-slate-800">
          {formatValue(achieved)} <span className="text-slate-400">/ {formatValue(target)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface TargetProgressItem {
  label: string;
  achieved: number;
  target: number;
  formatValue: (n: number) => string;
}

export default function TargetProgress({ title, items }: { title: string; items: TargetProgressItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="space-y-3">
        {items.map((it, i) => (
          <ProgressRow key={i} label={it.label} achieved={it.achieved} target={it.target} formatValue={it.formatValue} />
        ))}
      </div>
    </div>
  );
}
