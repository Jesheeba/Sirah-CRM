import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Entity = "leads" | "contacts" | "deals";
type DedupePolicy = "skip" | "merge" | "create";

interface ImportRequest {
  entity: Entity;
  filename: string;
  mapping: Record<string, string>; // csvHeader → fieldKey
  dedupe_field: "email" | "phone" | null;
  dedupe_policy: DedupePolicy;
  rows: Record<string, string>[];
}

// Allowed target fields per entity
const ENTITY_FIELDS: Record<Entity, string[]> = {
  leads:    ["first_name","last_name","email","phone","company","source","status"],
  contacts: ["first_name","last_name","email","phone","title"],
  deals:    ["name","amount","status","lost_reason"],
};

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ImportRequest | null;
  if (!body?.entity || !body?.rows?.length || !body?.mapping) {
    return NextResponse.json({ error: "entity, mapping, and rows are required." }, { status: 400 });
  }

  const { entity, filename, mapping, dedupe_field, dedupe_policy, rows } = body;
  const allowed = new Set(ENTITY_FIELDS[entity] ?? []);

  const supabase = await createClient();

  // Create job record
  const { data: job, error: jobErr } = await supabase
    .from("import_jobs")
    .insert({
      entity,
      filename: filename || "import.csv",
      status: "running",
      total: rows.length,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? "Could not create import job." }, { status: 500 });
  }

  const jobId = job.id;

  try {
    // Pre-load existing emails/phones for dedupe
    const dedupeValues = dedupe_field
      ? rows.map((r) => {
          const csvCol = Object.keys(mapping).find((k) => mapping[k] === dedupe_field);
          return csvCol ? (r[csvCol] ?? "").trim().toLowerCase() : "";
        }).filter(Boolean)
      : [];

    let existingMap = new Map<string, string>(); // value → record id

    if (dedupe_field && dedupeValues.length > 0) {
      const { data: existing } = await supabase
        .from(entity)
        .select(`id, ${dedupe_field}`)
        .in(dedupe_field, dedupeValues)
        .is("deleted_at", null);

      for (const rec of existing ?? []) {
        const val = (rec[dedupe_field as keyof typeof rec] as string | null)?.toLowerCase() ?? "";
        if (val) existingMap.set(val, rec.id as string);
      }
    }

    // Process rows
    let inserted = 0, updated = 0, skipped = 0, failed = 0;
    const errors: { row_index: number; row_data: Record<string,string>; error: string }[] = [];

    const insertBatch: Record<string, unknown>[] = [];
    const updateBatch: { id: string; data: Record<string, unknown> }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];

      // Apply mapping: csv header → field key → value
      const record: Record<string, unknown> = {};
      for (const [csvCol, fieldKey] of Object.entries(mapping)) {
        if (!fieldKey || !allowed.has(fieldKey)) continue;
        const val = (raw[csvCol] ?? "").trim();
        if (!val) continue;
        // Coerce amount to number
        if (fieldKey === "amount") {
          const n = parseFloat(val.replace(/[^0-9.]/g, ""));
          if (!isNaN(n)) record[fieldKey] = n;
        } else {
          record[fieldKey] = val;
        }
      }

      // Entity-specific validation
      if (entity === "deals" && !record.name) {
        errors.push({ row_index: i + 1, row_data: raw, error: "Deal name is required." });
        failed++;
        continue;
      }

      const dedupeVal = dedupe_field ? ((record[dedupe_field] as string) ?? "").toLowerCase() : null;
      const existingId = dedupeVal ? existingMap.get(dedupeVal) : undefined;

      if (existingId) {
        if (dedupe_policy === "skip") {
          skipped++;
          continue;
        } else if (dedupe_policy === "merge") {
          updateBatch.push({ id: existingId, data: record });
          continue;
        }
        // "create" falls through to insert
      }

      insertBatch.push(record);
    }

    // Bulk insert
    if (insertBatch.length) {
      const CHUNK = 200;
      for (let s = 0; s < insertBatch.length; s += CHUNK) {
        const chunk = insertBatch.slice(s, s + CHUNK);
        const { error: insErr } = await supabase.from(entity).insert(chunk as never);
        if (insErr) {
          // Fall back to row-by-row to surface individual errors
          for (let ci = 0; ci < chunk.length; ci++) {
            const { error: e2 } = await supabase.from(entity).insert(chunk[ci] as never);
            if (e2) {
              const rowIdx = s + ci;
              const origRow = rows[rowIdx] ?? {};
              errors.push({ row_index: rowIdx + 1, row_data: origRow, error: e2.message });
              failed++;
            } else {
              inserted++;
            }
          }
        } else {
          inserted += chunk.length;
        }
      }
    }

    // Bulk update (merge policy)
    for (const { id, data } of updateBatch) {
      const { error: upErr } = await supabase
        .from(entity)
        .update(data as never)
        .eq("id", id);
      if (upErr) {
        errors.push({ row_index: -1, row_data: {}, error: `Update ${id}: ${upErr.message}` });
        failed++;
      } else {
        updated++;
      }
    }

    // Store errors
    if (errors.length) {
      const errorRows = errors.slice(0, 1000).map((e) => ({
        job_id: jobId,
        row_index: e.row_index,
        row_data: e.row_data,
        error: e.error,
      }));
      await supabase.from("import_errors").insert(errorRows as never);
    }

    // Finalize job
    await supabase
      .from("import_jobs")
      .update({
        status: "done",
        inserted,
        updated,
        skipped,
        failed,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return NextResponse.json({ job_id: jobId, inserted, updated, skipped, failed, error_count: errors.length });
  } catch (e) {
    await supabase
      .from("import_jobs")
      .update({ status: "failed", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed." }, { status: 500 });
  }
}
