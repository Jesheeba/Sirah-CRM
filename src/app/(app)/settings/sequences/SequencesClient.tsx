"use client";

import { useState, useTransition } from "react";
import {
  createSequence,
  updateSequence,
  deleteSequence,
  createStep,
  updateStep,
  deleteStep,
  reorderSteps,
} from "./actions";
import type { Sequence, SequenceStep, SequenceChannel, SequenceStepContent } from "@/lib/types";

const CHANNEL_LABEL: Record<SequenceChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  task: "Task",
};

function stepsFor(steps: SequenceStep[], sequenceId: string) {
  return [...steps].filter((s) => s.sequence_id === sequenceId).sort((a, b) => a.step_order - b.step_order);
}

function delayLabel(hours: number) {
  if (hours === 0) return "immediately";
  if (hours % 24 === 0) return `${hours / 24}d later`;
  return `${hours}h later`;
}

// ── Step content editor (shape depends on channel) ──────────────────────────────

function ContentFields({
  channel,
  content,
  onChange,
}: {
  channel: SequenceChannel;
  content: SequenceStepContent;
  onChange: (c: SequenceStepContent) => void;
}) {
  const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand";
  if (channel === "task") {
    return (
      <input
        value={content.title ?? ""}
        onChange={(e) => onChange({ ...content, title: e.target.value })}
        placeholder="Task title, e.g. Call {{first_name}}"
        className={INPUT}
      />
    );
  }
  return (
    <div className="space-y-2">
      {channel === "email" && (
        <input
          value={content.subject ?? ""}
          onChange={(e) => onChange({ ...content, subject: e.target.value })}
          placeholder="Subject"
          className={INPUT}
        />
      )}
      <textarea
        value={content.body ?? ""}
        onChange={(e) => onChange({ ...content, body: e.target.value })}
        placeholder={`Message body — use {{first_name}}, {{last_name}}, {{company}}`}
        rows={3}
        className={INPUT}
      />
    </div>
  );
}

// ── Step row ─────────────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  isFirst,
  isLast,
  allSteps,
  onUpdate,
  onDelete,
  onReorder,
}: {
  step: SequenceStep;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  allSteps: SequenceStep[];
  onUpdate: (s: SequenceStep) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [delay, setDelay] = useState(step.delay_hours);
  const [content, setContent] = useState<SequenceStepContent>(step.content);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateStep(step.id, { delay_hours: delay, content });
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onUpdate({ ...step, delay_hours: delay, content });
      setEditing(false);
      setErr(null);
    });
  }

  function move(dir: -1 | 1) {
    const ordered = stepsFor(allSteps, step.sequence_id);
    const idx = ordered.findIndex((s) => s.id === step.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= ordered.length) return;
    const reordered = [...ordered];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    startTransition(async () => {
      await reorderSteps(step.sequence_id, reordered.map((s) => s.id));
      onReorder(reordered.map((s) => s.id));
    });
  }

  function handleDelete() {
    if (!confirm(`Delete step ${index + 1}?`)) return;
    startTransition(async () => {
      const res = await deleteStep(step.id);
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onDelete(step.id);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
          {index + 1}
        </span>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
          {CHANNEL_LABEL[step.channel]}
        </span>
        <span className="text-xs text-slate-400">{delayLabel(step.delay_hours)}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => move(-1)} disabled={isFirst || pending} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-20">▲</button>
          <button onClick={() => move(1)} disabled={isLast || pending} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-20">▼</button>
          <button onClick={() => setEditing((e) => !e)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            {editing ? "Close" : "Edit"}
          </button>
          <button onClick={handleDelete} disabled={pending} className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
            Delete
          </button>
        </div>
      </div>

      {!editing && (step.content.subject || step.content.body || step.content.title) && (
        <p className="mt-1.5 truncate pl-8 text-xs text-slate-400">
          {step.content.subject || step.content.title || step.content.body}
        </p>
      )}

      {editing && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {err && <p className="text-xs text-red-600">{err}</p>}
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Wait
            <input
              type="number"
              min={0}
              value={delay}
              onChange={(e) => setDelay(Number(e.target.value))}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
            />
            hours since the previous step, then:
          </label>
          <ContentFields channel={step.channel} content={content} onChange={setContent} />
          <button
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save step"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sequence card ────────────────────────────────────────────────────────────

function SequenceCard({
  sequence,
  steps,
  onUpdateSequence,
  onDeleteSequence,
  onStepsChange,
}: {
  sequence: Sequence;
  steps: SequenceStep[];
  onUpdateSequence: (id: string, updates: Partial<Sequence>) => void;
  onDeleteSequence: (id: string) => void;
  onStepsChange: (steps: SequenceStep[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(sequence.name);
  const [addingStep, setAddingStep] = useState(false);
  const [newChannel, setNewChannel] = useState<SequenceChannel>("email");
  const [newDelay, setNewDelay] = useState(0);
  const [newContent, setNewContent] = useState<SequenceStepContent>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mySteps = stepsFor(steps, sequence.id);

  function saveName() {
    if (!nameVal.trim()) return;
    startTransition(async () => {
      const res = await updateSequence(sequence.id, { name: nameVal.trim() });
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onUpdateSequence(sequence.id, { name: nameVal.trim() });
      setEditingName(false);
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const res = await updateSequence(sequence.id, { is_active: !sequence.is_active });
      if (res.ok) onUpdateSequence(sequence.id, { is_active: !sequence.is_active });
    });
  }

  function handleDelete() {
    if (!confirm(`Delete sequence "${sequence.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteSequence(sequence.id);
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onDeleteSequence(sequence.id);
    });
  }

  function handleAddStep() {
    startTransition(async () => {
      const res = await createStep(sequence.id, { channel: newChannel, delay_hours: newDelay, content: newContent });
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      if (res.step) onStepsChange([...steps, res.step]);
      setNewChannel("email");
      setNewDelay(0);
      setNewContent({});
      setAddingStep(false);
      setErr(null);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setExpanded((x) => !x)} className="text-slate-400 hover:text-slate-600">
          {expanded ? "▼" : "▶"}
        </button>
        {editingName ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              autoFocus
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold outline-none focus:border-brand"
            />
            <button onClick={saveName} disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Save</button>
            <button onClick={() => { setNameVal(sequence.name); setEditingName(false); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <span className="flex-1 font-semibold text-slate-800">{sequence.name}</span>
            {!sequence.is_active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Inactive</span>}
            <span className="text-xs text-slate-400">{mySteps.length} step{mySteps.length !== 1 ? "s" : ""}</span>
          </div>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
        {!editingName && (
          <div className="flex gap-1">
            <button onClick={toggleActive} disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
              {sequence.is_active ? "Pause" : "Activate"}
            </button>
            <button onClick={() => setEditingName(true)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Rename</button>
            <button onClick={handleDelete} disabled={pending} className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-slate-100 px-4 pb-4 pt-3">
          {mySteps.length === 0 && <p className="text-sm text-slate-400">No steps yet. Add one below.</p>}
          {mySteps.map((s, i) => (
            <StepRow
              key={s.id}
              step={s}
              index={i}
              isFirst={i === 0}
              isLast={i === mySteps.length - 1}
              allSteps={steps}
              onUpdate={(updated) => onStepsChange(steps.map((x) => (x.id === updated.id ? updated : x)))}
              onDelete={(id) => onStepsChange(steps.filter((x) => x.id !== id))}
              onReorder={(orderedIds) => {
                const updated = steps.map((s2) => {
                  const idx = orderedIds.indexOf(s2.id);
                  return idx >= 0 ? { ...s2, step_order: idx } : s2;
                });
                onStepsChange(updated);
              }}
            />
          ))}

          {addingStep ? (
            <div className="space-y-2 rounded-lg border border-brand/30 bg-brand/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select value={newChannel} onChange={(e) => { setNewChannel(e.target.value as SequenceChannel); setNewContent({}); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand">
                  {(["email", "whatsapp", "task"] as SequenceChannel[]).map((c) => (
                    <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  Wait
                  <input type="number" min={0} value={newDelay} onChange={(e) => setNewDelay(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand" />
                  hours
                </label>
              </div>
              <ContentFields channel={newChannel} content={newContent} onChange={setNewContent} />
              <div className="flex gap-2">
                <button onClick={handleAddStep} disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {pending ? "Adding…" : "Add step"}
                </button>
                <button onClick={() => setAddingStep(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingStep(true)} className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand">
              + Add step
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function SequencesClient({
  initialSequences,
  initialSteps,
}: {
  initialSequences: Sequence[];
  initialSteps: SequenceStep[];
}) {
  const [sequences, setSequences] = useState<Sequence[]>(initialSequences);
  const [steps, setSteps] = useState<SequenceStep[]>(initialSteps);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [globalErr, setGlobalErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createSequence(newName.trim());
      if (!res.ok) { setGlobalErr(res.error ?? "Failed"); return; }
      if (res.sequence) setSequences((s) => [...s, res.sequence!]);
      setNewName("");
      setAdding(false);
      setGlobalErr(null);
    });
  }

  return (
    <div className="space-y-4">
      {globalErr && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{globalErr}</div>}

      {sequences.map((seq) => (
        <SequenceCard
          key={seq.id}
          sequence={seq}
          steps={steps}
          onUpdateSequence={(id, updates) => setSequences((ss) => ss.map((s) => (s.id === id ? { ...s, ...updates } : s)))}
          onDeleteSequence={(id) => { setSequences((ss) => ss.filter((s) => s.id !== id)); setSteps((st) => st.filter((s) => s.sequence_id !== id)); }}
          onStepsChange={setSteps}
        />
      ))}

      {sequences.length === 0 && <p className="text-sm text-slate-500">No sequences yet. Create one below.</p>}

      {adding ? (
        <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Sequence name (e.g. New lead nurture)"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button onClick={handleAdd} disabled={pending || !newName.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {pending ? "Creating…" : "Create"}
          </button>
          <button onClick={() => setAdding(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand">
          + New sequence
        </button>
      )}
    </div>
  );
}
