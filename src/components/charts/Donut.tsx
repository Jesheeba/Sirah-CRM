export default function Donut({
  title,
  value,
  total,
  centerLabel,
  color = "#071689",
}: {
  title: string;
  value: number;
  total: number;
  centerLabel?: string;
  color?: string;
}) {
  const pct = total > 0 ? value / total : 0;
  const r = 42;
  const circ = 2 * Math.PI * r;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
          />
        </svg>
        <div>
          <div className="text-2xl font-bold text-slate-800">{Math.round(pct * 100)}%</div>
          <div className="text-xs text-slate-400">{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}
