export interface BarItem {
  label: string;
  value: number;
  sub?: string; // right-aligned label; falls back to the formatted value
}

export default function BarList({
  title,
  items,
  valueFormat,
  empty,
}: {
  title: string;
  items: BarItem[];
  valueFormat?: (n: number) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {items.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">{empty ?? "No data yet."}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((i, idx) => (
            <li key={idx}>
              <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-600">{i.label}</span>
                <span className="shrink-0 font-medium text-slate-700">
                  {i.sub ?? (valueFormat ? valueFormat(i.value) : i.value)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
