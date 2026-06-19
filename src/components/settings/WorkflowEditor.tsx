"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACTION_LABELS,
  ACTION_TYPES,
  CONDITION_OPERATORS,
  ENTITY_FIELDS,
  ENTITY_LABEL,
  OPERATOR_LABELS,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
} from "@/lib/workflows";
import type {
  ActionType,
  ConditionOperator,
  TriggerType,
  Workflow,
  WorkflowAction,
  WorkflowCondition,
  WorkflowRunLog,
  WorkflowTrigger,
} from "@/lib/types";

const INPUT =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

export default function WorkflowEditor({
  workflow,
  initialTriggers,
  initialConditions,
  initialActions,
  runLogs,
}: {
  workflow: Workflow;
  initialTriggers: WorkflowTrigger[];
  initialConditions: WorkflowCondition[];
  initialActions: WorkflowAction[];
  runLogs: WorkflowRunLog[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const fields = ENTITY_FIELDS[workflow.entity_type];

  const [name, setName] = useState(workflow.name);
  const [active, setActive] = useState(workflow.is_active);
  const [trigger, setTrigger] = useState<WorkflowTrigger | null>(initialTriggers[0] ?? null);
  const [conditions, setConditions] = useState<WorkflowCondition[]>(initialConditions);
  const [actions, setActions] = useState<WorkflowAction[]>(initialActions);
  const [error, setError] = useState<string | null>(null);

  // Add-condition form
  const [cGroup, setCGroup] = useState("1");
  const [cField, setCField] = useState(fields[0]?.key ?? "");
  const [cOp, setCOp] = useState<ConditionOperator>("eq");
  const [cValue, setCValue] = useState("");

  // Add-action form
  const [aType, setAType] = useState<ActionType>("create_task");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [aField, setAField] = useState(fields[0]?.key ?? "");
  const [aValue, setAValue] = useState("");

  function fail(e: { message: string } | null) {
    if (e) setError(e.message);
    return !!e;
  }

  // -- header ---------------------------------------------------------------
  async function saveName() {
    if (name.trim() === workflow.name || !name.trim()) return;
    const { error } = await supabase.from("workflows").update({ name: name.trim() }).eq("id", workflow.id);
    fail(error);
  }

  async function toggleActive() {
    const next = !active;
    setActive(next);
    setError(null);
    const { error } = await supabase.from("workflows").update({ is_active: next }).eq("id", workflow.id);
    if (error) {
      setActive(!next);
      setError(error.message);
    }
  }

  async function remove() {
    const { error } = await supabase
      .from("workflows")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", workflow.id);
    if (fail(error)) return;
    router.push("/settings/workflows");
  }

  // -- trigger --------------------------------------------------------------
  async function changeTriggerType(t: TriggerType) {
    setError(null);
    const config = t === "field_changed" ? { field: fields[0]?.key ?? "" } : {};
    if (trigger) {
      const { error } = await supabase
        .from("workflow_triggers")
        .update({ trigger_type: t, config })
        .eq("id", trigger.id);
      if (fail(error)) return;
      setTrigger({ ...trigger, trigger_type: t, config });
    } else {
      const { data, error } = await supabase
        .from("workflow_triggers")
        .insert({ workflow_id: workflow.id, trigger_type: t, config })
        .select("*")
        .single();
      if (fail(error)) return;
      setTrigger(data as WorkflowTrigger);
    }
  }

  async function changeTriggerField(field: string) {
    if (!trigger) return;
    const config = { ...trigger.config, field };
    const { error } = await supabase.from("workflow_triggers").update({ config }).eq("id", trigger.id);
    if (fail(error)) return;
    setTrigger({ ...trigger, config });
  }

  // -- conditions -----------------------------------------------------------
  async function addCondition() {
    setError(null);
    if (!cField) return setError("Pick a field for the condition.");
    const { data, error } = await supabase
      .from("workflow_conditions")
      .insert({
        workflow_id: workflow.id,
        group_no: Number(cGroup) || 1,
        field: cField,
        operator: cOp,
        value: cOp === "is_empty" ? null : cValue,
      })
      .select("*")
      .single();
    if (fail(error)) return;
    setConditions((cs) => [...cs, data as WorkflowCondition]);
    setCValue("");
  }

  async function removeCondition(id: string) {
    const prev = conditions;
    setConditions((cs) => cs.filter((c) => c.id !== id));
    const { error } = await supabase.from("workflow_conditions").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setConditions(prev);
    }
  }

  // -- actions --------------------------------------------------------------
  async function addAction() {
    setError(null);
    let config: Record<string, unknown>;
    if (aType === "create_task") {
      if (!taskTitle.trim()) return setError("Enter a task title.");
      config = {
        title: taskTitle.trim(),
        ...(taskDue ? { due_in_days: taskDue } : {}),
        priority: taskPriority,
      };
    } else {
      if (!aField) return setError("Pick a field to update.");
      config = { field: aField, value: aValue };
    }
    const { data, error } = await supabase
      .from("workflow_actions")
      .insert({
        workflow_id: workflow.id,
        action_type: aType,
        config,
        execution_order: actions.length,
      })
      .select("*")
      .single();
    if (fail(error)) return;
    setActions((as) => [...as, data as WorkflowAction]);
    setTaskTitle("");
    setTaskDue("");
    setAValue("");
  }

  async function removeAction(id: string) {
    const prev = actions;
    setActions((as) => as.filter((a) => a.id !== id));
    const { error } = await supabase.from("workflow_actions").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setActions(prev);
    }
  }

  function actionSummary(a: WorkflowAction) {
    const c = a.config as Record<string, string>;
    if (a.action_type === "create_task") {
      return `“${c.title ?? "Workflow task"}”${c.due_in_days ? ` · due in ${c.due_in_days}d` : ""}`;
    }
    return `${c.field} = ${c.value ?? "(empty)"}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/settings/workflows" className="hover:underline">Workflows</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{name}</span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium outline-none focus:border-brand"
          />
          <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-xs font-medium capitalize text-brand">
            {ENTITY_LABEL[workflow.entity_type]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleActive}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              active
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {active ? "● Active" : "○ Inactive"}
          </button>
          <button
            onClick={remove}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Trigger */}
      <Card title="When… (trigger)" hint="The event on a record that starts this workflow.">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={trigger?.trigger_type ?? "record_updated"}
            onChange={(e) => changeTriggerType(e.target.value as TriggerType)}
            className={INPUT}
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
          {trigger?.trigger_type === "field_changed" && (
            <select
              value={(trigger.config as Record<string, string>).field ?? ""}
              onChange={(e) => changeTriggerField(e.target.value)}
              className={INPUT}
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </Card>

      {/* Conditions */}
      <Card
        title="If… (conditions)"
        hint="Conditions in the same group are ANDed; separate groups are ORed. No conditions = always runs."
      >
        {conditions.length > 0 && (
          <ul className="space-y-2">
            {conditions.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">
                  <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                    group {c.group_no}
                  </span>
                  <span className="font-medium">{c.field}</span>{" "}
                  {OPERATOR_LABELS[c.operator]}{" "}
                  {c.operator !== "is_empty" && (
                    <span className="font-medium">{String(c.value ?? "")}</span>
                  )}
                </span>
                <button
                  onClick={() => removeCondition(c.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <input
            type="number"
            min={1}
            value={cGroup}
            onChange={(e) => setCGroup(e.target.value)}
            title="Group number"
            className={INPUT}
            placeholder="Group"
          />
          <select value={cField} onChange={(e) => setCField(e.target.value)} className={INPUT}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={cOp}
            onChange={(e) => setCOp(e.target.value as ConditionOperator)}
            className={INPUT}
          >
            {CONDITION_OPERATORS.map((o) => (
              <option key={o} value={o}>
                {OPERATOR_LABELS[o]}
              </option>
            ))}
          </select>
          <input
            value={cValue}
            onChange={(e) => setCValue(e.target.value)}
            disabled={cOp === "is_empty"}
            placeholder="Value"
            className={`${INPUT} disabled:bg-slate-100`}
          />
          <button
            onClick={addCondition}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Add
          </button>
        </div>
      </Card>

      {/* Actions */}
      <Card title="Then… (actions)" hint="Run in order when the trigger fires and conditions match.">
        {actions.length > 0 && (
          <ul className="space-y-2">
            {actions.map((a, i) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">
                  <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                    {i + 1}
                  </span>
                  <span className="font-medium">{ACTION_LABELS[a.action_type]}</span>{" "}
                  <span className="text-slate-500">{actionSummary(a)}</span>
                </span>
                <button
                  onClick={() => removeAction(a.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-lg border border-dashed border-slate-200 p-3">
          <select
            value={aType}
            onChange={(e) => setAType(e.target.value as ActionType)}
            className={`${INPUT} w-full sm:w-48`}
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTION_LABELS[t]}
              </option>
            ))}
          </select>
          {aType === "create_task" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Task title"
                className={`${INPUT} sm:col-span-2`}
              />
              <input
                type="number"
                min={0}
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
                placeholder="Due in days"
                className={INPUT}
              />
              <select
                value={taskPriority}
                onChange={(e) => setTaskPriority(e.target.value)}
                className={INPUT}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select value={aField} onChange={(e) => setAField(e.target.value)} className={INPUT}>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                value={aValue}
                onChange={(e) => setAValue(e.target.value)}
                placeholder="New value"
                className={INPUT}
              />
            </div>
          )}
          <button
            onClick={addAction}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Add action
          </button>
        </div>
      </Card>

      {/* Run log */}
      <Card title="Run log" hint="Most recent runs (newest first) — for debugging.">
        {runLogs.length === 0 ? (
          <p className="text-sm text-slate-400">
            No runs yet. Activate the workflow and change a {workflow.entity_type.slice(0, -1)} to see it fire.
          </p>
        ) : (
          <ul className="space-y-1">
            {runLogs.map((l) => {
              const d = (l.detail ?? {}) as Record<string, string>;
              return (
                <li key={l.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      l.status === "success"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {l.status}
                  </span>
                  <span className="text-slate-600">
                    {d.action ?? "—"}
                    {d.error ? ` · ${d.error}` : ""}
                  </span>
                  <span className="ml-auto text-slate-400">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
