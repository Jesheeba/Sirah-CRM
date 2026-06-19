"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import TasksCalendar from "@/components/tasks/TasksCalendar";
import {
  TASK_PRIORITIES,
  type RelatedType,
  type Task,
  type TaskPriority,
} from "@/lib/types";

export interface Member {
  id: string;
  full_name: string | null;
  email: string | null;
}

type Tab = "open" | "today" | "upcoming" | "overdue" | "completed" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  low: "bg-slate-100 text-slate-500",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-rose-100 text-rose-700",
};

const REL_PATH: Record<RelatedType, string> = {
  lead: "/leads",
  contact: "/contacts",
  account: "/accounts",
  deal: "/deals",
};

function memberName(m: Member | undefined) {
  if (!m) return "Unassigned";
  return m.full_name || m.email || "(member)";
}

function sameDay(iso: string, ref: Date) {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function isOverdue(t: Task) {
  return t.status === "open" && t.due_at != null && new Date(t.due_at).getTime() < Date.now();
}

function reminderDue(t: Task) {
  return t.status === "open" && t.remind_at != null && new Date(t.remind_at).getTime() <= Date.now();
}

export default function TasksClient({
  initial,
  members,
  userId,
  defaultMine,
  canSeeTeam,
}: {
  initial: Task[];
  members: Member[];
  userId: string;
  defaultMine: boolean;
  canSeeTeam: boolean;
}) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [view, setView] = useState<"mine" | "team">(canSeeTeam && !defaultMine ? "team" : "mine");
  const [tab, setTab] = useState<Tab>("open");
  const [display, setDisplay] = useState<"list" | "calendar">("list");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create-form state
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [remind, setRemind] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignee, setAssignee] = useState(userId);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const owned = tasks.filter((t) =>
    view === "mine" || !canSeeTeam ? t.assignee_id === userId : true,
  );

  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const today = new Date();

  function pred(t: Task, k: Tab): boolean {
    switch (k) {
      case "open":
        return t.status === "open";
      case "completed":
        return t.status === "done";
      case "all":
        return true;
      case "today":
        return t.status === "open" && t.due_at != null && sameDay(t.due_at, today);
      case "upcoming":
        return t.status === "open" && t.due_at != null && new Date(t.due_at) > endToday;
      case "overdue":
        return isOverdue(t);
    }
  }

  const visible = owned.filter((t) => pred(t, tab));
  const count = (k: Tab) => owned.filter((t) => pred(t, k)).length;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Enter a task title.");
    setBusy(true);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: title.trim(),
        due_at: due || null,
        remind_at: remind || null,
        priority,
        status: "open",
        assignee_id: assignee || null,
        owner_id: userId,
      })
      .select("*")
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setTasks((ts) => [data as Task, ...ts]);
    setTitle("");
    setDue("");
    setRemind("");
    setPriority("normal");
    setAssignee(userId);
    setShow(false);
  }

  async function toggle(t: Task) {
    const next = t.status === "open" ? "done" : "open";
    const prev = tasks;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", t.id);
    if (error) {
      setError(error.message);
      setTasks(prev);
    }
  }

  async function remove(id: string) {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setError(error.message);
      setTasks(prev);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">My Work</h1>
          {canSeeTeam && (
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button
                onClick={() => setView("mine")}
                className={`rounded-md px-2 py-1 font-medium ${
                  view === "mine" ? "bg-brand text-white" : "text-slate-600"
                }`}
              >
                Mine
              </button>
              <button
                onClick={() => setView("team")}
                className={`rounded-md px-2 py-1 font-medium ${
                  view === "team" ? "bg-brand text-white" : "text-slate-600"
                }`}
              >
                Team
              </button>
            </div>
          )}
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button
              onClick={() => setDisplay("list")}
              className={`rounded-md px-2 py-1 font-medium ${
                display === "list" ? "bg-brand text-white" : "text-slate-600"
              }`}
            >
              List
            </button>
            <button
              onClick={() => setDisplay("calendar")}
              className={`rounded-md px-2 py-1 font-medium ${
                display === "calendar" ? "bg-brand text-white" : "text-slate-600"
              }`}
            >
              Calendar
            </button>
          </div>
        </div>
        <button
          onClick={() => setShow((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + New task
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {show && (
        <form
          onSubmit={create}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4"
        >
          <input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <label className="text-xs text-slate-500">
            Due
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="text-xs text-slate-500">
            Reminder
            <input
              type="datetime-local"
              value={remind}
              onChange={(e) => setRemind(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {memberName(m)}
                {m.id === userId ? " (me)" : ""}
              </option>
            ))}
          </select>
          <div className="sm:col-span-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Add task"}
            </button>
          </div>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label}
            <span className={`text-xs ${tab === t.key ? "text-white/80" : "text-slate-400"}`}>
              {count(t.key)}
            </span>
          </button>
        ))}
      </div>

      {display === "calendar" ? (
        <TasksCalendar tasks={owned} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    {tab === "overdue"
                      ? "Nothing overdue. 👍"
                      : tab === "completed"
                        ? "No completed tasks yet."
                        : "No tasks here — you're all caught up. 🎉"}
                  </td>
                </tr>
              )}
              {visible.map((t) => {
                const overdue = isOverdue(t);
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={t.status === "done"}
                        onChange={() => toggle(t)}
                        className="h-4 w-4 rounded border-slate-300"
                        title={t.status === "done" ? "Reopen" : "Mark done"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/tasks/${t.id}`}
                        className={`font-medium hover:underline ${
                          t.status === "done" ? "text-slate-400 line-through" : "text-slate-800"
                        }`}
                      >
                        {t.title}
                      </Link>
                      {reminderDue(t) && <span title="Reminder due" className="ml-1">🔔</span>}
                      {t.related_to_type && t.related_to_id && (
                        <Link
                          href={`${REL_PATH[t.related_to_type]}/${t.related_to_id}`}
                          className="ml-2 text-xs text-brand hover:underline"
                        >
                          🔗 {t.related_to_type}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {memberName(memberById.get(t.assignee_id ?? ""))}
                    </td>
                    <td className="px-4 py-3">
                      {t.due_at ? (
                        <span className={overdue ? "font-medium text-rose-600" : "text-slate-600"}>
                          {new Date(t.due_at).toLocaleDateString()}
                          {overdue && " · overdue"}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${PRIORITY_STYLE[t.priority]}`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(t.id)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
