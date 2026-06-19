"use client";

import { useState } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function TasksCalendar({ tasks }: { tasks: Task[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_at) continue;
    const key = dayKey(new Date(t.due_at));
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const navBtn =
    "rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <div className="flex gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className={navBtn}>‹</button>
          <button
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className={navBtn}
          >
            Today
          </button>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className={navBtn}>›</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-px rounded-lg bg-slate-200 text-xs">
          {DOW.map((d) => (
            <div key={d} className="bg-slate-50 px-2 py-1 font-medium text-slate-500">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={i} className="min-h-[88px] bg-slate-50/60" />;
            const date = new Date(year, month, day);
            const isToday = dayKey(date) === dayKey(today);
            const dayTasks = byDay.get(dayKey(date)) ?? [];
            return (
              <div key={i} className="min-h-[88px] bg-white p-1">
                <div
                  className={`mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    isToday ? "bg-brand font-semibold text-white" : "text-slate-500"
                  }`}
                >
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map((t) => {
                    const overdue =
                      t.status === "open" && t.due_at != null && new Date(t.due_at).getTime() < Date.now();
                    return (
                      <Link
                        key={t.id}
                        href={`/tasks/${t.id}`}
                        title={t.title}
                        className={`block truncate rounded px-1 py-0.5 text-[11px] ${
                          t.status === "done"
                            ? "bg-slate-100 text-slate-400 line-through"
                            : overdue
                              ? "bg-rose-100 text-rose-700"
                              : "bg-brand-50 text-brand"
                        }`}
                      >
                        {t.title}
                      </Link>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="px-1 text-[10px] text-slate-400">+{dayTasks.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
