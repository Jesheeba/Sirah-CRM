"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RelatedType, TimelineItem } from "@/lib/types";

const KIND_ICON: Record<TimelineItem["kind"], string> = {
  note: "📝",
  activity: "📞",
  task: "✅",
};

type CallDirection = "outbound" | "inbound";
type CallOutcome   = "answered" | "no_answer" | "busy" | "left_voicemail";

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  answered:       "Answered",
  no_answer:      "No answer",
  busy:           "Busy",
  left_voicemail: "Left voicemail",
};

const DIR_STYLE: Record<CallDirection, string> = {
  outbound: "bg-blue-100 text-blue-700",
  inbound:  "bg-purple-100 text-purple-700",
};

const OUTCOME_STYLE: Record<CallOutcome, string> = {
  answered:       "bg-green-100 text-green-700",
  no_answer:      "bg-amber-100 text-amber-700",
  busy:           "bg-red-100 text-red-700",
  left_voicemail: "bg-slate-100 text-slate-600",
};

// subject encoding for calls: "direction|outcome|duration|notes"
function encodeCall(dir: CallDirection, outcome: CallOutcome, mins: string, notes: string) {
  return [dir, outcome, mins, notes.replace(/\|/g, " ")].join("|");
}

function decodeCall(subject: string) {
  const [dir = "", outcome = "", mins = "", ...rest] = subject.split("|");
  return {
    direction: dir as CallDirection,
    outcome:   outcome as CallOutcome,
    duration:  mins,
    notes:     rest.join("|"),
  };
}

function fmt(at: string) {
  try { return new Date(at).toLocaleString(); } catch { return at; }
}

export default function RecordTimeline({
  recordType,
  recordId,
  userId,
  initialItems,
}: {
  recordType: RelatedType;
  recordId: string;
  userId: string;
  initialItems: TimelineItem[];
}) {
  const supabase = createClient();
  const [items, setItems]       = useState<TimelineItem[]>(initialItems);
  const [mode, setMode]         = useState<"note" | "activity" | "call" | "task">("note");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [editId, setEditId]     = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Note state
  const [body, setBody] = useState("");

  // Generic activity state
  const [actType, setActType] = useState("meeting");
  const [subject, setSubject] = useState("");

  // Call state
  const [callDir,      setCallDir]      = useState<CallDirection>("outbound");
  const [callOutcome,  setCallOutcome]  = useState<CallOutcome>("answered");
  const [callDuration, setCallDuration] = useState("");
  const [callNotes,    setCallNotes]    = useState("");

  // Task state
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue,   setTaskDue]   = useState("");

  // ── actions ────────────────────────────────────────────────────────────────

  async function addNote() {
    if (!body.trim()) return;
    setBusy(true); setError(null);
    const { data, error } = await supabase
      .from("notes")
      .insert({ body: body.trim(), related_to_type: recordType, related_to_id: recordId, owner_id: userId })
      .select().single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [{ id: data.id, kind: "note", text: data.body, at: data.created_at }, ...xs]);
    setBody("");
  }

  async function logActivity() {
    if (!subject.trim()) return;
    setBusy(true); setError(null);
    const { data, error } = await supabase
      .from("activities")
      .insert({ type: actType, subject: subject.trim(), related_to_type: recordType, related_to_id: recordId, owner_id: userId })
      .select().single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [{ id: data.id, kind: "activity", text: data.subject, meta: data.type, at: data.occurred_at }, ...xs]);
    setSubject("");
  }

  async function logCall() {
    setBusy(true); setError(null);
    const encoded = encodeCall(callDir, callOutcome, callDuration, callNotes);
    const { data, error } = await supabase
      .from("activities")
      .insert({
        type: "call",
        subject: encoded,
        description: callNotes,
        related_to_type: recordType,
        related_to_id: recordId,
        owner_id: userId,
      })
      .select().single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [{ id: data.id, kind: "activity", text: data.subject, meta: "call", at: data.occurred_at }, ...xs]);
    setCallDuration("");
    setCallNotes("");
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    setBusy(true); setError(null);
    const { data, error } = await supabase
      .from("tasks")
      .insert({ title: taskTitle.trim(), due_at: taskDue || null, status: "open", related_to_type: recordType, related_to_id: recordId, assignee_id: userId, owner_id: userId })
      .select().single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [{ id: data.id, kind: "task", text: data.title, meta: "open", at: data.created_at }, ...xs]);
    setTaskTitle(""); setTaskDue("");
  }

  async function toggleTask(it: TimelineItem) {
    const next = it.meta === "done" ? "open" : "done";
    const prev = items;
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, meta: next } : x)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", it.id);
    if (error) { setError(error.message); setItems(prev); }
  }

  async function removeItem(it: TimelineItem) {
    const prev = items;
    setItems((xs) => xs.filter((x) => !(x.id === it.id && x.kind === it.kind)));
    setError(null);
    let res;
    if (it.kind === "note") {
      res = await supabase.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", it.id);
    } else if (it.kind === "task") {
      res = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", it.id);
    } else {
      res = await supabase.from("activities").delete().eq("id", it.id);
    }
    if (res.error) { setError(res.error.message); setItems(prev); }
  }

  async function saveEdit(it: TimelineItem) {
    const text = editDraft.trim();
    if (!text) return;
    const { error } = await supabase.from("notes").update({ body: text }).eq("id", it.id);
    if (error) return setError(error.message);
    setItems((xs) => xs.map((x) => (x.id === it.id && x.kind === "note" ? { ...x, text } : x)));
    setEditId(null);
  }

  // ── tab styles ─────────────────────────────────────────────────────────────

  const tabClass = (m: typeof mode) =>
    `rounded-md px-3 py-1 text-xs font-medium transition-colors ${
      mode === m ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  const INPUT = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";
  const BTN   = "rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50";

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {/* Mode tabs */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setMode("note")}     className={tabClass("note")}>Note</button>
        <button onClick={() => setMode("call")}     className={tabClass("call")}>📞 Log call</button>
        <button onClick={() => setMode("activity")} className={tabClass("activity")}>Activity</button>
        <button onClick={() => setMode("task")}     className={tabClass("task")}>Task</button>
      </div>

      {/* Note */}
      {mode === "note" && (
        <div className="space-y-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" rows={2} className={`w-full ${INPUT}`} />
          <button onClick={addNote} disabled={busy} className={BTN}>Save note</button>
        </div>
      )}

      {/* Log call */}
      {mode === "call" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Direction</label>
              <select value={callDir} onChange={(e) => setCallDir(e.target.value as CallDirection)} className={`w-full ${INPUT}`}>
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Outcome</label>
              <select value={callOutcome} onChange={(e) => setCallOutcome(e.target.value as CallOutcome)} className={`w-full ${INPUT}`}>
                <option value="answered">Answered</option>
                <option value="no_answer">No answer</option>
                <option value="busy">Busy</option>
                <option value="left_voicemail">Left voicemail</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Duration (min)</label>
              <input type="number" min={0} value={callDuration} onChange={(e) => setCallDuration(e.target.value)} placeholder="5" className={`w-full ${INPUT}`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Notes</label>
            <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="What was discussed?" rows={2} className={`w-full ${INPUT}`} />
          </div>
          <button onClick={logCall} disabled={busy} className={BTN}>
            {busy ? "Saving…" : "Log call"}
          </button>
        </div>
      )}

      {/* Generic activity */}
      {mode === "activity" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select value={actType} onChange={(e) => setActType(e.target.value)} className={INPUT}>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
            <option value="other">Other</option>
          </select>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What happened?" className={`flex-1 ${INPUT}`} />
          <button onClick={logActivity} disabled={busy} className={BTN}>Log</button>
        </div>
      )}

      {/* Task */}
      {mode === "task" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task title…" className={`flex-1 ${INPUT}`} />
          <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className={INPUT} />
          <button onClick={addTask} disabled={busy} className={BTN}>Add task</button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Timeline */}
      <ul className="mt-4 space-y-3">
        {items.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">
            No activity yet — add a note, log a call, or create a task.
          </li>
        )}
        {items.map((it) => (
          <li key={`${it.kind}-${it.id}`} className="group flex gap-3 border-b border-slate-100 pb-3 last:border-0">
            {it.kind === "task" ? (
              <input
                type="checkbox"
                checked={it.meta === "done"}
                onChange={() => toggleTask(it)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                title={it.meta === "done" ? "Reopen" : "Mark done"}
              />
            ) : (
              <span className="text-base leading-none">{KIND_ICON[it.kind]}</span>
            )}

            <div className="min-w-0 flex-1">
              {editId === it.id && it.kind === "note" ? (
                <div className="space-y-1">
                  <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={2}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand" />
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(it)} className="text-xs font-medium text-brand hover:underline">Save</button>
                    <button onClick={() => setEditId(null)} className="text-xs text-slate-500 hover:underline">Cancel</button>
                  </div>
                </div>
              ) : it.kind === "activity" && it.meta === "call" ? (
                /* ── Call activity — structured display ── */
                <CallEntry text={it.text} />
              ) : (
                <div className="text-sm text-slate-700">
                  {it.meta && it.kind === "activity" && (
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs capitalize text-slate-500">
                      {it.meta}
                    </span>
                  )}
                  <span className={it.kind === "task" && it.meta === "done" ? "text-slate-400 line-through" : ""}>
                    {it.text}
                  </span>
                </div>
              )}

              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                <span>{fmt(it.at)}</span>
                {editId !== it.id && (
                  <span className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    {it.kind === "note" && (
                      <button onClick={() => { setEditId(it.id); setEditDraft(it.text); }} className="hover:text-brand">
                        Edit
                      </button>
                    )}
                    <button onClick={() => removeItem(it)} className="hover:text-red-600">Delete</button>
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Call entry renderer ────────────────────────────────────────────────────────

function CallEntry({ text }: { text: string }) {
  const { direction, outcome, duration, notes } = decodeCall(text);

  const dirLabel     = direction === "inbound" ? "Inbound" : "Outbound";
  const outcomeLabel = OUTCOME_LABEL[outcome as CallOutcome] ?? outcome;
  const dirCls       = DIR_STYLE[direction as CallDirection]     ?? "bg-slate-100 text-slate-500";
  const outcomeCls   = OUTCOME_STYLE[outcome as CallOutcome]     ?? "bg-slate-100 text-slate-500";

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${dirCls}`}>{dirLabel}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${outcomeCls}`}>{outcomeLabel}</span>
        {duration && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {duration} min
          </span>
        )}
      </div>
      {notes && <p className="text-sm text-slate-700">{notes}</p>}
    </div>
  );
}
