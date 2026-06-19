"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { combineDateTime } from "@/lib/calendar";
import { EVENT_TYPES, type CalendarEvent, type EventType } from "@/lib/types";

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50 disabled:text-slate-500";

function keyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function EventModal({
  event,
  defaultDateKey,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
}: {
  event: CalendarEvent | null;
  defaultDateKey: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (e: CalendarEvent) => void;
  onDeleted: (id: string) => void;
}) {
  const supabase = createClient();
  const ro = !canEdit;

  const [title, setTitle] = useState(event?.title ?? "");
  const [type, setType] = useState<EventType>(event?.event_type ?? "meeting");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [startDate, setStartDate] = useState(event ? keyOf(event.starts_at) : defaultDateKey);
  const [startTime, setStartTime] = useState(event && !event.all_day ? timeOf(event.starts_at) : "09:00");
  const [endDate, setEndDate] = useState(event ? keyOf(event.ends_at) : defaultDateKey);
  const [endTime, setEndTime] = useState(event && !event.all_day ? timeOf(event.ends_at) : "10:00");
  const [location, setLocation] = useState(event?.location ?? "");
  const [attendees, setAttendees] = useState(event?.attendees ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return setError("Title is required.");
    setBusy(true);
    setError(null);
    const starts_at = combineDateTime(startDate, allDay ? "00:00" : startTime);
    const ends_at = combineDateTime(endDate || startDate, allDay ? "23:59" : endTime || startTime);
    if (new Date(ends_at) < new Date(starts_at)) {
      setBusy(false);
      return setError("End must be after start.");
    }
    const payload = {
      title: title.trim(),
      event_type: type,
      all_day: allDay,
      starts_at,
      ends_at,
      location: location.trim() || null,
      attendees: attendees.trim() || null,
      description: description.trim() || null,
    };

    if (event) {
      const { data, error } = await supabase
        .from("calendar_events")
        .update(payload)
        .eq("id", event.id)
        .select("*")
        .single();
      setBusy(false);
      if (error) return setError(error.message);
      onSaved(data as CalendarEvent);
    } else {
      const { data, error } = await supabase
        .from("calendar_events")
        .insert(payload)
        .select("*")
        .single();
      setBusy(false);
      if (error) return setError(error.message);
      onSaved(data as CalendarEvent);
    }
  }

  async function remove() {
    if (!event) return;
    setError(null);
    const { error } = await supabase
      .from("calendar_events")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", event.id);
    if (error) return setError(error.message);
    onDeleted(event.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="mt-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{event ? "Event" : "New event"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {ro && (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Read-only — only the owner, Managers and Admins can edit this event.
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className={LABEL}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as EventType)} disabled={ro} className={`${INPUT} capitalize`}>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={ro} />
              All day
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={ro} className={INPUT} />
            </div>
            {!allDay && (
              <div>
                <label className={LABEL}>Start time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={ro} className={INPUT} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={ro} className={INPUT} />
            </div>
            {!allDay && (
              <div>
                <label className={LABEL}>End time</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={ro} className={INPUT} />
              </div>
            )}
          </div>
          <div>
            <label className={LABEL}>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Attendees</label>
            <input value={attendees} onChange={(e) => setAttendees(e.target.value)} disabled={ro} placeholder="comma-separated emails" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={ro} rows={3} className={INPUT} />
          </div>
        </div>

        {canEdit && (
          <div className="mt-4 flex items-center justify-between gap-2">
            {event ? (
              <button onClick={remove} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Delete
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Saving…" : event ? "Save" : "Create"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
