export interface MiniBar {
  label: string;
  value: number;
}

export default function MiniBars({
  title,
  items,
  valueFormat,
}: {
  title: string;
  items: MiniBar[];
  valueFormat?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="flex h-36 items-end gap-2">
        {items.map((i, idx) => (
          <div key={idx} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-brand transition-all"
                style={{ height: `${(i.value / max) * 100}%` }}
                title={valueFormat ? valueFormat(i.value) : String(i.value)}
              />
            </div>
            <span className="text-[10px] text-slate-400">{i.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
