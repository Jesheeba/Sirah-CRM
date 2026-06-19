"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RelatedType, TimelineItem } from "@/lib/types";

const KIND_ICON: Record<TimelineItem["kind"], string> = {
  note: "📝",
  activity: "📞",
  task: "✅",
};

function fmt(at: string) {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
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
  const [items, setItems] = useState<TimelineItem[]>(initialItems);
  const [mode, setMode] = useState<"note" | "activity" | "task">("note");
  const [body, setBody] = useState("");
  const [actType, setActType] = useState("call");
  const [subject, setSubject] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  async function addNote() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("notes")
      .insert({
        body: body.trim(),
        related_to_type: recordType,
        related_to_id: recordId,
        owner_id: userId,
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [
      { id: data.id, kind: "note", text: data.body, at: data.created_at },
      ...xs,
    ]);
    setBody("");
  }

  async function logActivity() {
    if (!subject.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("activities")
      .insert({
        type: actType,
        subject: subject.trim(),
        related_to_type: recordType,
        related_to_id: recordId,
        owner_id: userId,
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [
      { id: data.id, kind: "activity", text: data.subject, meta: data.type, at: data.occurred_at },
      ...xs,
    ]);
    setSubject("");
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: taskTitle.trim(),
        due_at: taskDue || null,
        status: "open",
        related_to_type: recordType,
        related_to_id: recordId,
        assignee_id: userId,
        owner_id: userId,
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setItems((xs) => [
      { id: data.id, kind: "task", text: data.title, meta: "open", at: data.created_at },
      ...xs,
    ]);
    setTaskTitle("");
    setTaskDue("");
  }

  async function toggleTask(it: TimelineItem) {
    const next = it.meta === "done" ? "open" : "done";
    const prev = items;
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, meta: next } : x)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", it.id);
    if (error) {
      setError(error.message);
      setItems(prev);
    }
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
      res = await supabase.from("activities").delete().eq("id", it.id); // no soft-delete column
    }
    if (res.error) {
      setError(res.error.message);
      setItems(prev);
    }
  }

  async function saveEdit(it: TimelineItem) {
    const text = editDraft.trim();
    if (!text) return;
    const { error } = await supabase.from("notes").update({ body: text }).eq("id", it.id);
    if (error) return setError(error.message);
    setItems((xs) => xs.map((x) => (x.id === it.id && x.kind === "note" ? { ...x, text } : x)));
    setEditId(null);
  }

  const tabClass = (m: typeof mode) =>
    `rounded-md px-3 py-1 text-xs font-medium ${
      mode === m ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
    }`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex gap-2">
        <button onClick={() => setMode("note")} className={tabClass("note")}>Note</button>
        <button onClick={() => setMode("activity")} className={tabClass("activity")}>Log activity</button>
        <button onClick={() => setMode("task")} className={tabClass("task")}>Task</button>
      </div>

      {mode === "note" && (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={addNote}
            disabled={busy}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      )}

      {mode === "activity" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={actType}
            onChange={(e) => setActType(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
          </select>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What happened?"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={logActivity}
            disabled={busy}
            className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Log
          </button>
        </div>
      )}

      {mode === "task" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            type="date"
            value={taskDue}
            onChange={(e) => setTaskDue(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={addTask}
            disabled={busy}
            className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Add task
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <ul className="mt-4 space-y-3">
        {items.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">
            No activity yet — add a note, log a touch, or create a task.
          </li>
        )}
        {items.map((it) => (
          <li
            key={`${it.kind}-${it.id}`}
            className="group flex gap-3 border-b border-slate-100 pb-3 last:border-0"
          >
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
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(it)} className="text-xs font-medium text-brand hover:underline">
                      Save
                    </button>
                    <button onClick={() => setEditId(null)} className="text-xs text-slate-500 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
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
                      <button
                        onClick={() => {
                          setEditId(it.id);
                          setEditDraft(it.text);
                        }}
                        className="hover:text-brand"
                      >
                        Edit
                      </button>
                    )}
                    <button onClick={() => removeItem(it)} className="hover:text-red-600">
                      Delete
                    </button>
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
