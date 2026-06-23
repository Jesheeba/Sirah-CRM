"use client";

import { useState, useTransition } from "react";
import {
  createPipeline,
  updatePipeline,
  setDefaultPipeline,
  deletePipeline,
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
} from "./pipeline-actions";
import type { Pipeline, Stage } from "@/lib/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function stagesFor(stages: Stage[], pipelineId: string) {
  return [...stages]
    .filter((s) => s.pipeline_id === pipelineId)
    .sort((a, b) => a.display_order - b.display_order);
}

// ── Stage row ────────────────────────────────────────────────────────────────

function StageRow({
  stage,
  isFirst,
  isLast,
  pipelineId,
  allStages,
  onUpdate,
  onDelete,
  onReorder,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  pipelineId: string;
  allStages: Stage[];
  onUpdate: (s: Stage) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [prob, setProb] = useState(stage.probability);
  const [isWon, setIsWon] = useState(stage.is_won);
  const [isLost, setIsLost] = useState(stage.is_lost);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await updateStage(stage.id, {
        name: name.trim(),
        probability: prob,
        is_won: isWon,
        is_lost: isLost,
      });
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onUpdate({ ...stage, name: name.trim(), probability: prob, is_won: isWon, is_lost: isLost });
      setEditing(false);
      setErr(null);
    });
  }

  function cancel() {
    setName(stage.name);
    setProb(stage.probability);
    setIsWon(stage.is_won);
    setIsLost(stage.is_lost);
    setEditing(false);
    setErr(null);
  }

  function moveUp() {
    const ordered = stagesFor(allStages, pipelineId);
    const idx = ordered.findIndex((s) => s.id === stage.id);
    if (idx <= 0) return;
    const newOrder = [...ordered];
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
    startTransition(async () => {
      await reorderStages(pipelineId, newOrder.map((s) => s.id));
      onReorder(newOrder.map((s) => s.id));
    });
  }

  function moveDown() {
    const ordered = stagesFor(allStages, pipelineId);
    const idx = ordered.findIndex((s) => s.id === stage.id);
    if (idx >= ordered.length - 1) return;
    const newOrder = [...ordered];
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    startTransition(async () => {
      await reorderStages(pipelineId, newOrder.map((s) => s.id));
      onReorder(newOrder.map((s) => s.id));
    });
  }

  function handleDelete() {
    if (!confirm(`Delete stage "${stage.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteStage(stage.id);
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onDelete(stage.id);
    });
  }

  const tagStyle = stage.is_won
    ? "bg-green-100 text-green-700"
    : stage.is_lost
      ? "bg-rose-100 text-rose-700"
      : "bg-slate-100 text-slate-600";

  if (editing) {
    return (
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 space-y-2">
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
            placeholder="Stage name"
            autoFocus
          />
          <input
            type="number"
            min={0}
            max={100}
            value={prob}
            onChange={(e) => setProb(Number(e.target.value))}
            className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
            placeholder="%"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={isWon}
              onChange={(e) => { setIsWon(e.target.checked); if (e.target.checked) setIsLost(false); }}
              className="rounded"
            />
            Won stage
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={isLost}
              onChange={(e) => { setIsLost(e.target.checked); if (e.target.checked) setIsWon(false); }}
              className="rounded"
            />
            Lost stage
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={pending || !name.trim()}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={moveUp}
          disabled={isFirst || pending}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-20"
          title="Move up"
        >
          ▲
        </button>
        <button
          onClick={moveDown}
          disabled={isLast || pending}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-20"
          title="Move down"
        >
          ▼
        </button>
      </div>

      <span className="flex-1 text-sm text-slate-800">{stage.name}</span>

      <span className="text-xs text-slate-400">{stage.probability}%</span>

      {(stage.is_won || stage.is_lost) && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tagStyle}`}>
          {stage.is_won ? "Won" : "Lost"}
        </span>
      )}

      {err && <span className="text-xs text-red-600">{err}</span>}

      <button
        onClick={() => setEditing(true)}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <button
        onClick={handleDelete}
        disabled={pending}
        className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}

// ── Pipeline card ─────────────────────────────────────────────────────────────

function PipelineCard({
  pipeline,
  stages,
  onUpdatePipeline,
  onDeletePipeline,
  onSetDefault,
  onStagesChange,
}: {
  pipeline: Pipeline;
  stages: Stage[];
  onUpdatePipeline: (id: string, name: string) => void;
  onDeletePipeline: (id: string) => void;
  onSetDefault: (id: string) => void;
  onStagesChange: (stages: Stage[]) => void;
}) {
  const [expanded, setExpanded] = useState(pipeline.is_default);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(pipeline.name);
  const [err, setErr] = useState<string | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageProb, setNewStageProb] = useState(50);
  const [newIsWon, setNewIsWon] = useState(false);
  const [newIsLost, setNewIsLost] = useState(false);
  const [pending, startTransition] = useTransition();

  const pipeStages = stagesFor(stages, pipeline.id);

  function saveName() {
    if (!nameVal.trim()) return;
    startTransition(async () => {
      const res = await updatePipeline(pipeline.id, { name: nameVal.trim() });
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onUpdatePipeline(pipeline.id, nameVal.trim());
      setEditingName(false);
      setErr(null);
    });
  }

  function handleSetDefault() {
    startTransition(async () => {
      const res = await setDefaultPipeline(pipeline.id);
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onSetDefault(pipeline.id);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete pipeline "${pipeline.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deletePipeline(pipeline.id);
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      onDeletePipeline(pipeline.id);
    });
  }

  function handleAddStage() {
    if (!newStageName.trim()) return;
    startTransition(async () => {
      const res = await createStage(pipeline.id, {
        name: newStageName.trim(),
        probability: newStageProb,
        is_won: newIsWon,
        is_lost: newIsLost,
      });
      if (!res.ok) { setErr(res.error ?? "Failed"); return; }
      if (res.stage) onStagesChange([...stages, res.stage]);
      setNewStageName("");
      setNewStageProb(50);
      setNewIsWon(false);
      setNewIsLost(false);
      setAddingStage(false);
      setErr(null);
    });
  }

  function handleStageUpdate(updated: Stage) {
    onStagesChange(stages.map((s) => (s.id === updated.id ? updated : s)));
  }

  function handleStageDelete(id: string) {
    onStagesChange(stages.filter((s) => s.id !== id));
  }

  function handleReorder(orderedIds: string[]) {
    const updated = stages.map((s) => {
      const idx = orderedIds.indexOf(s.id);
      return idx >= 0 ? { ...s, display_order: idx } : s;
    });
    onStagesChange(updated);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {/* Pipeline header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-slate-400 hover:text-slate-600"
          title={expanded ? "Collapse" : "Expand"}
        >
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
            <button
              onClick={saveName}
              disabled={pending || !nameVal.trim()}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "…" : "Save"}
            </button>
            <button
              onClick={() => { setNameVal(pipeline.name); setEditingName(false); }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <span className="flex-1 font-semibold text-slate-800">{pipeline.name}</span>
            {pipeline.is_default && (
              <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">
                Default
              </span>
            )}
            <span className="text-xs text-slate-400">{pipeStages.length} stages</span>
          </div>
        )}

        {err && <span className="text-xs text-red-600">{err}</span>}

        {!editingName && (
          <div className="flex gap-1">
            <button
              onClick={() => setEditingName(true)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Rename
            </button>
            {!pipeline.is_default && (
              <button
                onClick={handleSetDefault}
                disabled={pending}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Set default
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={pending || pipeline.is_default}
              title={pipeline.is_default ? "Cannot delete the default pipeline" : "Delete pipeline"}
              className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Stage list */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-2">
          {pipeStages.length === 0 && (
            <p className="text-sm text-slate-400">No stages yet. Add one below.</p>
          )}

          {pipeStages.map((s, i) => (
            <StageRow
              key={s.id}
              stage={s}
              isFirst={i === 0}
              isLast={i === pipeStages.length - 1}
              pipelineId={pipeline.id}
              allStages={stages}
              onUpdate={handleStageUpdate}
              onDelete={handleStageDelete}
              onReorder={handleReorder}
            />
          ))}

          {/* Add stage */}
          {addingStage ? (
            <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Stage name"
                  autoFocus
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newStageProb}
                  onChange={(e) => setNewStageProb(Number(e.target.value))}
                  className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
                  placeholder="%"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={newIsWon}
                    onChange={(e) => { setNewIsWon(e.target.checked); if (e.target.checked) setNewIsLost(false); }}
                    className="rounded"
                  />
                  Won stage
                </label>
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={newIsLost}
                    onChange={(e) => { setNewIsLost(e.target.checked); if (e.target.checked) setNewIsWon(false); }}
                    className="rounded"
                  />
                  Lost stage
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddStage}
                  disabled={pending || !newStageName.trim()}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Adding…" : "Add stage"}
                </button>
                <button
                  onClick={() => setAddingStage(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingStage(true)}
              className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand"
            >
              + Add stage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function PipelinesClient({
  initialPipelines,
  initialStages,
}: {
  initialPipelines: Pipeline[];
  initialStages: Stage[];
}) {
  const [pipelines, setPipelines] = useState<Pipeline[]>(initialPipelines);
  const [stages, setStages] = useState<Stage[]>(initialStages);
  const [addingPipeline, setAddingPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [globalErr, setGlobalErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAddPipeline() {
    if (!newPipelineName.trim()) return;
    startTransition(async () => {
      const res = await createPipeline(newPipelineName.trim());
      if (!res.ok) { setGlobalErr(res.error ?? "Failed"); return; }
      if (res.pipeline) setPipelines((ps) => [...ps, res.pipeline!]);
      if (res.stages) setStages((ss) => [...ss, ...res.stages!]);
      setNewPipelineName("");
      setAddingPipeline(false);
      setGlobalErr(null);
    });
  }

  function handleUpdatePipeline(id: string, name: string) {
    setPipelines((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function handleDeletePipeline(id: string) {
    setPipelines((ps) => ps.filter((p) => p.id !== id));
    setStages((ss) => ss.filter((s) => s.pipeline_id !== id));
  }

  function handleSetDefault(id: string) {
    setPipelines((ps) => ps.map((p) => ({ ...p, is_default: p.id === id })));
  }

  return (
    <div className="space-y-4">
      {globalErr && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {globalErr}
        </div>
      )}

      {pipelines.map((pl) => (
        <PipelineCard
          key={pl.id}
          pipeline={pl}
          stages={stages}
          onUpdatePipeline={handleUpdatePipeline}
          onDeletePipeline={handleDeletePipeline}
          onSetDefault={handleSetDefault}
          onStagesChange={setStages}
        />
      ))}

      {pipelines.length === 0 && (
        <p className="text-sm text-slate-500">No pipelines yet. Create one below.</p>
      )}

      {addingPipeline ? (
        <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <input
            value={newPipelineName}
            onChange={(e) => setNewPipelineName(e.target.value)}
            placeholder="Pipeline name (e.g. Sales, Renewals)"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleAddPipeline(); }}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={handleAddPipeline}
            disabled={pending || !newPipelineName.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create"}
          </button>
          <button
            onClick={() => setAddingPipeline(false)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingPipeline(true)}
          className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand"
        >
          + New pipeline
        </button>
      )}
    </div>
  );
}
