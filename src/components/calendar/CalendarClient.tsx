"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  addDays,
  addMonths,
  dateKey,
  EVENT_TYPE_STYLE,
  fmtMonthYear,
  fmtTime,
  isoToKey,
  monthMatrix,
  moveIsoToDay,
  sameDay,
  startOfMonth,
  weekDays,
  WEEKDAY_LABELS,
} from "@/lib/calendar";
import type { CalendarEvent } from "@/lib/types";
import EventModal from "./EventModal";

export interface CalTask {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  assignee_id: string | null;
  owner_id: string | null;
}

type View = "month" | "week";
type Drag = { kind: "event" | "task"; id: string } | null;

export default function CalendarClient({
  initialEvents,
  tasks: initialTasks,
  currentUserId,
  canManageAll,
  icsToken,
}: {
  initialEvents: CalendarEvent[];
  tasks: CalTask[];
  currentUserId: string;
  canManageAll: boolean;
  icsToken: string | null;
}) {
  const supabase = createClient();
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [tasks, setTasks] = useState<CalTask[]>(initialTasks);
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [mineOnly, setMineOnly] = useState(false);
  const [modal, setModal] = useState<{ event: CalendarEvent | null; dateKey: string } | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<Drag>(null);

  const today = new Date();

  const canEditEvent = (e: CalendarEvent) => canManageAll || e.owner_id === currentUserId;
  const canEditTask = (t: CalTask) =>
    canManageAll || t.assignee_id === currentUserId || t.owner_id === currentUserId;

  // Bucket items by local day key, honoring the Mine/Team filter.
  const byDay = useMemo(() => {
    const map = new Map<string, { events: CalendarEvent[]; tasks: CalTask[] }>();
    const slot = (k: string) => {
      let s = map.get(k);
      if (!s) map.set(k, (s = { events: [], tasks: [] }));
      return s;
    };
    for (const e of events) {
      if (mineOnly && e.owner_id !== currentUserId) continue;
      slot(isoToKey(e.starts_at)).events.push(e);
    }
    for (const t of tasks) {
      if (!t.due_at) continue;
      if (mineOnly && t.assignee_id !== currentUserId && t.owner_id !== currentUserId) continue;
      slot(isoToKey(t.due_at)).tasks.push(t);
    }
    return map;
  }, [events, tasks, mineOnly, currentUserId]);

  const days = view === "month" ? monthMatrix(anchor) : weekDays(anchor);
  const monthForGrid = startOfMonth(anchor).getMonth();

  function go(dir: -1 | 0 | 1) {
    if (dir === 0) return setAnchor(new Date());
    setAnchor((a) => (view === "month" ? addMonths(a, dir) : addDays(a, dir * 7)));
  }

  async function reschedule(targetKey: string) {
    const d = dragItem;
    setDragItem(null);
    if (!d) return;
    setError(null);

    if (d.kind === "event") {
      const ev = events.find((x) => x.id === d.id);
      if (!ev) return;
      if (!canEditEvent(ev)) return setError("You can only move your own events.");
      if (isoToKey(ev.starts_at) === targetKey) return;
      const newStart = moveIsoToDay(ev.starts_at, targetKey);
      const dur = new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime();
      const newEnd = new Date(new Date(newStart).getTime() + dur).toISOString();
      setEvents((es) => es.map((x) => (x.id === ev.id ? { ...x, starts_at: newStart, ends_at: newEnd } : x)));
      const { error } = await supabase
        .from("calendar_events")
        .update({ starts_at: newStart, ends_at: newEnd })
        .eq("id", ev.id);
      if (error) setError(error.message);
    } else {
      const t = tasks.find((x) => x.id === d.id);
      if (!t || !t.due_at) return;
      if (!canEditTask(t)) return setError("You can only move your own tasks.");
      if (isoToKey(t.due_at) === targetKey) return;
      const newDue = moveIsoToDay(t.due_at, targetKey);
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, due_at: newDue } : x)));
      const { error } = await supabase.from("tasks").update({ due_at: newDue }).eq("id", t.id);
      if (error) setError(error.message);
    }
  }

  function upsertEvent(e: CalendarEvent) {
    setEvents((es) => (es.some((x) => x.id === e.id) ? es.map((x) => (x.id === e.id ? e : x)) : [...es, e]));
    setModal(null);
  }
  function removeEvent(id: string) {
    setEvents((es) => es.filter((x) => x.id !== id));
    setModal(null);
  }

  const icsUrl = icsToken ? `/api/calendar/ics?token=${icsToken}` : null;

  function DayCell({ d, tall }: { d: Date; tall?: boolean }) {
    const k = dateKey(d);
    const slot = byDay.get(k);
    const inMonth = view === "week" || d.getMonth() === monthForGrid;
    const isToday = sameDay(d, today);
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => reschedule(k)}
        className={`flex flex-col gap-1 border-b border-r border-slate-100 p-1.5 ${
          tall ? "min-h-[7rem]" : "min-h-[5.5rem]"
        } ${inMonth ? "bg-white" : "bg-slate-50/60"}`}
      >
        <button
          onClick={() => setModal({ event: null, dateKey: k })}
          className="flex items-center justify-between text-left"
          title="Add event"
        >
          <span
            className={`text-xs font-medium ${
              isToday
                ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white"
                : inMonth
                  ? "text-slate-600"
                  : "text-slate-300"
            }`}
          >
            {d.getDate()}
          </span>
        </button>

        <div className="flex flex-col gap-1">
          {slot?.events.map((e) => (
            <button
              key={e.id}
              draggable={canEditEvent(e)}
              onDragStart={() => setDragItem({ kind: "event", id: e.id })}
              onClick={() => setModal({ event: e, dateKey: k })}
              className={`truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${EVENT_TYPE_STYLE[e.event_type]}`}
              title={e.title}
            >
              {!e.all_day && <span className="opacity-70">{fmtTime(e.starts_at)} </span>}
              {e.title}
            </button>
          ))}
          {slot?.tasks.map((t) => (
            <Link
              key={t.id}
              href={`/tasks/${t.id}`}
              draggable={canEditTask(t)}
              onDragStart={() => setDragItem({ kind: "task", id: t.id })}
              className={`truncate rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ${
                t.status === "done" ? "line-through opacity-60" : ""
              }`}
              title={t.title}
            >
              ✓ {t.title}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const rangeTitle =
    view === "month"
      ? fmtMonthYear(anchor)
      : `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(
          undefined,
          { month: "short", day: "numeric", year: "numeric" }
        )}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2">
          {icsUrl && (
            <button onClick={() => setShowSubscribe((s) => !s)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Subscribe
            </button>
          )}
          <button onClick={() => setModal({ event: null, dateKey: dateKey(today) })} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            + New event
          </button>
        </div>
      </div>

      {showSubscribe && icsUrl && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="mb-2 text-slate-600">
            Add this URL in Google / Outlook / Apple Calendar (“Subscribe to calendar from URL”) for a live feed of your events &amp; tasks:
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={typeof window !== "undefined" ? `${window.location.origin}${icsUrl}` : icsUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 outline-none"
            />
            <button
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${icsUrl}`)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button onClick={() => go(-1)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">‹</button>
            <button onClick={() => go(0)} className="border-x border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Today</button>
            <button onClick={() => go(1)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">›</button>
          </div>
          <span className="text-sm font-semibold text-slate-700">{rangeTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMineOnly((m) => !m)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              mineOnly ? "border-brand bg-brand-50 text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {mineOnly ? "My calendar" : "Team calendar"}
          </button>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {(["month", "week"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm capitalize ${view === v ? "bg-brand-50 text-brand" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-xl border-l border-t border-slate-100 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="border-r border-slate-100 px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => (
            <DayCell key={dateKey(d)} d={d} tall={view === "week"} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-brand/30 bg-brand-50" /> Meeting</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-green-300 bg-green-50" /> Call</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-amber-300 bg-amber-50" /> Event</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-purple-300 bg-purple-50" /> Reminder</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-slate-200 bg-slate-50" /> Task</span>
        <span className="text-slate-400">· drag an item to reschedule</span>
      </div>

      {modal && (
        <EventModal
          event={modal.event}
          defaultDateKey={modal.dateKey}
          canEdit={modal.event ? canEditEvent(modal.event) : true}
          onClose={() => setModal(null)}
          onSaved={upsertEvent}
          onDeleted={removeEvent}
        />
      )}
    </div>
  );
}
