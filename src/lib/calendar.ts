import type { EventType } from "@/lib/types";

// ── Local-time date math (no external date library) ──────────────────────────
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function startOfWeek(d: Date): Date {
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
}
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local YYYY-MM-DD key for day-bucketing. */
export function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
export function isoToKey(iso: string): string {
  return dateKey(new Date(iso));
}

/** 42-cell (6×7) month grid starting on the Sunday on/before the 1st. */
export function monthMatrix(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** The 7 days of the week containing `anchor`. */
export function weekDays(anchor: Date): Date[] {
  const s = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Combine a 'YYYY-MM-DD' + 'HH:MM' (local) into a stored ISO string. */
export function combineDateTime(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr || "00:00"}`).toISOString();
}

/** Move an ISO timestamp to a new day (target key), preserving time-of-day. */
export function moveIsoToDay(iso: string, targetKey: string): string {
  const src = new Date(iso);
  const [y, m, d] = targetKey.split("-").map(Number);
  return new Date(y, m - 1, d, src.getHours(), src.getMinutes(), src.getSeconds()).toISOString();
}

export const EVENT_TYPE_STYLE: Record<EventType, string> = {
  meeting: "bg-brand-50 text-brand border-brand/30",
  call: "bg-green-50 text-green-700 border-green-300",
  event: "bg-amber-50 text-amber-700 border-amber-300",
  reminder: "bg-purple-50 text-purple-700 border-purple-300",
};
