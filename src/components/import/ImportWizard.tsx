"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";

type Entity = "leads" | "contacts" | "deals";
type DedupePolicy = "skip" | "merge" | "create";
type Step = "entity" | "upload" | "map" | "options" | "done";

interface JobResult {
  job_id: string;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  error_count: number;
}

const ENTITY_FIELDS: Record<Entity, { key: string; label: string; required?: boolean }[]> = {
  leads: [
    { key: "first_name", label: "First name" },
    { key: "last_name",  label: "Last name" },
    { key: "email",      label: "Email" },
    { key: "phone",      label: "Phone" },
    { key: "company",    label: "Company" },
    { key: "source",     label: "Source" },
    { key: "status",     label: "Status" },
  ],
  contacts: [
    { key: "first_name", label: "First name" },
    { key: "last_name",  label: "Last name" },
    { key: "email",      label: "Email" },
    { key: "phone",      label: "Phone" },
    { key: "title",      label: "Title" },
  ],
  deals: [
    { key: "name",        label: "Deal name", required: true },
    { key: "amount",      label: "Amount" },
    { key: "status",      label: "Status (open/won/lost)" },
    { key: "lost_reason", label: "Lost reason" },
  ],
};

const ENTITY_LABELS: Record<Entity, string> = {
  leads:    "Leads",
  contacts: "Contacts",
  deals:    "Deals",
};

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {title && <h2 className="mb-4 text-base font-semibold text-slate-700">{title}</h2>}
      {children}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "entity", label: "Entity" },
    { key: "upload", label: "Upload" },
    { key: "map",    label: "Map fields" },
    { key: "options",label: "Options" },
    { key: "done",   label: "Done" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold ${
              i < idx  ? "bg-brand text-white" :
              i === idx ? "bg-brand text-white ring-2 ring-brand/30" :
              "bg-slate-100 text-slate-400"
            }`}
          >
            {i < idx ? "✓" : i + 1}
          </span>
          <span className={i <= idx ? "text-slate-700" : "text-slate-400"}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-slate-300">›</span>}
        </div>
      ))}
    </div>
  );
}

// Auto-match CSV headers to field keys (fuzzy)
function autoMap(
  headers: string[],
  fields: { key: string; label: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = fields.find((f) => {
      const fk = f.key.replace(/_/g, "");
      const fl = f.label.toLowerCase().replace(/[^a-z0-9]/g, "");
      return norm === fk || norm === fl || norm.includes(fk) || fk.includes(norm);
    });
    if (match) result[h] = match.key;
  }
  return result;
}

export default function ImportWizard() {
  const [step, setStep]         = useState<Step>("entity");
  const [entity, setEntity]     = useState<Entity>("leads");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders]   = useState<string[]>([]);
  const [rows, setRows]         = useState<Record<string, string>[]>([]);
  const [mapping, setMapping]   = useState<Record<string, string>>({});
  const [dedupeField, setDedupeField] = useState<"email" | "phone" | "">("");
  const [dedupePolicy, setDedupePolicy] = useState<DedupePolicy>("skip");
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<JobResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = ENTITY_FIELDS[entity];
  const previewRows = rows.slice(0, 5);

  // Step 1 → pick entity
  function selectEntity(e: Entity) {
    setEntity(e);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setStep("upload");
  }

  // Step 2 → parse CSV
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setError(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.data.length) { setError("CSV is empty."); return; }
        const hdrs = result.meta.fields ?? [];
        setHeaders(hdrs);
        setRows(result.data as Record<string, string>[]);
        setMapping(autoMap(hdrs, ENTITY_FIELDS[entity]));
        setStep("map");
      },
      error: (err) => setError(err.message),
    });
  }

  // Step 4 → run import
  async function runImport() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          filename,
          mapping,
          dedupe_field: dedupeField || null,
          dedupe_policy: dedupePolicy,
          rows,
        }),
      });
      const json = await res.json() as JobResult | { error: string };
      if ("error" in json) { setError(json.error); }
      else { setResult(json); setStep("done"); }
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setStep("entity");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <StepBar step={step} />

      {/* Step 1: Entity */}
      {step === "entity" && (
        <Card title="What do you want to import?">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["leads","contacts","deals"] as Entity[]).map((e) => (
              <button
                key={e}
                onClick={() => selectEntity(e)}
                className="rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand hover:bg-brand/5 transition-all"
              >
                <p className="font-semibold text-slate-700">{ENTITY_LABELS[e]}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {e === "leads" && "Names, emails, phones, source"}
                  {e === "contacts" && "Names, emails, phones, title"}
                  {e === "deals"    && "Deal names, amounts, stages"}
                </p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Step 2: Upload */}
      {step === "upload" && (
        <Card title={`Upload ${ENTITY_LABELS[entity]} CSV`}>
          <p className="mb-4 text-sm text-slate-500">
            The first row must be a header row. Required columns vary — you will map them in the next step.
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 hover:border-brand hover:bg-brand/5 transition-all">
            <span className="text-3xl mb-2">📂</span>
            <span className="text-sm font-medium text-slate-600">Click to choose a CSV file</span>
            <span className="text-xs text-slate-400 mt-1">Up to 10 000 rows</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button onClick={() => setStep("entity")} className="mt-4 text-xs text-slate-400 hover:underline">
            ← Back
          </button>
        </Card>
      )}

      {/* Step 3: Field mapping */}
      {step === "map" && (
        <Card title="Map CSV columns to CRM fields">
          <p className="mb-4 text-sm text-slate-500">
            {rows.length.toLocaleString()} rows detected in <span className="font-medium">{filename}</span>.
            Unmapped columns are ignored.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="pb-2 text-left font-medium w-1/2">CSV column</th>
                  <th className="pb-2 text-left font-medium w-1/2">CRM field</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h) => (
                  <tr key={h} className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{h}</td>
                    <td className="py-1.5">
                      <select
                        value={mapping[h] ?? ""}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setMapping((prev) => {
                            const next = { ...prev };
                            if (v) next[h] = v;
                            else delete next[h];
                            return next;
                          });
                        }}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand"
                      >
                        <option value="">— skip —</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}{f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Preview */}
          {previewRows.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">Preview (first {previewRows.length} rows)</p>
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      {Object.values(mapping).filter(Boolean).map((fk) => (
                        <th key={fk} className="px-3 py-1.5 text-left font-medium text-slate-500">
                          {fields.find((f) => f.key === fk)?.label ?? fk}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {Object.entries(mapping)
                          .filter(([, v]) => v)
                          .map(([csvCol]) => (
                            <td key={csvCol} className="px-3 py-1.5 text-slate-600">
                              {row[csvCol] ?? ""}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep("upload")} className="text-xs text-slate-400 hover:underline">
              ← Back
            </button>
            <button
              onClick={() => setStep("options")}
              className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Continue →
            </button>
          </div>
        </Card>
      )}

      {/* Step 4: Dedupe options + run */}
      {step === "options" && (
        <Card title="Import options">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Duplicate detection field</label>
              <select
                value={dedupeField}
                onChange={(e) => setDedupeField(e.target.value as "email" | "phone" | "")}
                className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="">None — always create new records</option>
                {entity !== "deals" && <option value="email">Email</option>}
                {entity !== "deals" && <option value="phone">Phone</option>}
              </select>
            </div>

            {dedupeField && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">When a duplicate is found</label>
                <div className="space-y-2">
                  {[
                    { v: "skip",   label: "Skip", desc: "Don't import the row — keep the existing record unchanged" },
                    { v: "merge",  label: "Update", desc: "Update the existing record with values from the CSV" },
                    { v: "create", label: "Always create", desc: "Create a new record even if one already exists" },
                  ].map((opt) => (
                    <label key={opt.v} className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="policy"
                        value={opt.v}
                        checked={dedupePolicy === opt.v}
                        onChange={() => setDedupePolicy(opt.v as DedupePolicy)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="text-sm font-medium text-slate-700">{opt.label}</span>
                        <span className="ml-2 text-xs text-slate-400">{opt.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <span className="font-medium text-slate-600">{rows.length.toLocaleString()} rows</span> from{" "}
              <span className="font-medium text-slate-600">{filename}</span> will be imported as{" "}
              <span className="font-medium text-slate-600">{ENTITY_LABELS[entity]}</span>.
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setStep("map")} className="text-xs text-slate-400 hover:underline">
                ← Back
              </button>
              <button
                onClick={() => void runImport()}
                disabled={running}
                className="ml-auto rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {running ? "Importing…" : `Import ${rows.length.toLocaleString()} rows`}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 5: Done */}
      {step === "done" && result && (
        <Card title="Import complete">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
            <div className="rounded-lg bg-green-50 p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{result.inserted}</p>
              <p className="text-xs text-green-600">Created</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
              <p className="text-xs text-blue-600">Updated</p>
            </div>
            <div className="rounded-lg bg-slate-100 p-3 text-center">
              <p className="text-2xl font-bold text-slate-600">{result.skipped}</p>
              <p className="text-xs text-slate-500">Skipped</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-center">
              <p className="text-2xl font-bold text-red-700">{result.failed}</p>
              <p className="text-xs text-red-600">Failed</p>
            </div>
          </div>

          {result.error_count > 0 && (
            <a
              href={`/api/import/errors?job_id=${result.job_id}`}
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              ⬇ Download {result.error_count} error row{result.error_count !== 1 ? "s" : ""} (.csv)
            </a>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={reset}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Import another file
            </button>
            <a
              href={`/${entity}`}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              View {ENTITY_LABELS[entity]}
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
