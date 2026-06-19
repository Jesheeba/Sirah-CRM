"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/components/tasks/TasksClient";
import {
  TASK_PRIORITIES,
  type RelatedType,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/types";

const REL_PATH: Record<RelatedType, string> = {
  lead: "/leads",
  contact: "/contacts",
  account: "/accounts",
  deal: "/deals",
};

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50 disabled:text-slate-500";

function toDateInput(iso: string | null) {
  return iso ? iso.slice(0, 10) : "";
}
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function TaskDetailClient({
  task,
  members,
  canManage,
}: {
  task: Task;
  members: Member[];
  canManage: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [due, setDue] = useState(toDateInput(task.due_at));
  const [remind, setRemind] = useState(toLocalInput(task.remind_at));
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function persist(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    return true;
  }

  async function save() {
    if (!title.trim()) return setError("Title is required.");
    const ok = await persist({
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      due_at: due || null,
      remind_at: remind ? new Date(remind).toISOString() : null,
      assignee_id: assignee || null,
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    }
  }

  async function toggleStatus() {
    const next: TaskStatus = status === "open" ? "done" : "open";
    setStatus(next);
    await persist({ status: next });
    router.refresh();
  }

  async function remove() {
    const ok = await persist({ deleted_at: new Date().toISOString() });
    if (ok) router.push("/tasks");
  }

  const ro = !canManage;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/tasks" className="hover:underline">My Work</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{task.title}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{title || "Task"}</h1>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleStatus}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                status === "done"
                  ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  : "bg-green-100 text-green-700 hover:bg-green-200"
              }`}
            >
              {status === "done" ? "↺ Reopen" : "✓ Mark done"}
            </button>
            <button
              onClick={remove}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {ro && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Read-only — this task isn’t assigned to or owned by you.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <label className={LABEL}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={ro} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={ro}
              rows={3}
              className={INPUT}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                disabled={ro}
                className={`${INPUT} capitalize`}
              >
                <option value="open">Open</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                disabled={ro}
                className={`${INPUT} capitalize`}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Due date</label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={ro} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Reminder</label>
              <input
                type="datetime-local"
                value={remind}
                onChange={(e) => setRemind(e.target.value)}
                disabled={ro}
                className={INPUT}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>Assignee</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                disabled={ro}
                className={INPUT}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email || "(member)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={busy}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
              {saved && <span className="text-sm text-green-600">Saved ✓</span>}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Linked record</h3>
            {task.related_to_type && task.related_to_id ? (
              <Link
                href={`${REL_PATH[task.related_to_type]}/${task.related_to_id}`}
                className="block rounded-md px-2 py-1 text-sm text-brand hover:bg-slate-50"
              >
                🔗 View {task.related_to_type}
              </Link>
            ) : (
              <p className="px-2 py-1 text-sm text-slate-400">Not linked to a record.</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Details</h3>
            <div className="px-2 py-1">
              Created: <span className="text-slate-800">{new Date(task.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
