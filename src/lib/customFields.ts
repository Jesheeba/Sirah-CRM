import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldDef } from "@/components/record/EditableFields";
import type { CustomFieldDef, EntityType } from "@/lib/types";

const COLS =
  "id, entity_type, field_key, label, data_type, options, is_required, display_order";

function rowToDef(r: any): CustomFieldDef {
  return {
    id: r.id,
    entity_type: r.entity_type,
    field_key: r.field_key,
    label: r.label,
    data_type: r.data_type,
    options: Array.isArray(r.options) ? r.options : null,
    is_required: !!r.is_required,
    display_order: r.display_order ?? 0,
  };
}

/** Raw custom-field definitions for one entity, ordered for display. */
export async function fetchCustomFieldDefs(
  supabase: SupabaseClient,
  entityType: EntityType,
): Promise<CustomFieldDef[]> {
  const { data } = await supabase
    .from("custom_field_definitions")
    .select(COLS)
    .eq("entity_type", entityType)
    .order("display_order");
  return ((data ?? []) as any[]).map(rowToDef);
}

/** Map a definition to an EditableFields FieldDef (for record detail pages). */
export function cfToFieldDef(def: CustomFieldDef): FieldDef {
  return {
    key: def.field_key,
    label: def.label,
    type: def.data_type,
    options: def.options ?? undefined,
    custom: true,
  };
}

/**
 * Detail-page helper: every record page calls this identically and spreads the
 * result after its standard fields — no entity-specific code.
 */
export async function customFieldDefsFor(
  supabase: SupabaseClient,
  entityType: EntityType,
): Promise<FieldDef[]> {
  return (await fetchCustomFieldDefs(supabase, entityType)).map(cfToFieldDef);
}

/** Trim + drop empties → the object to persist into the `custom_fields` JSONB. */
export function cleanCustomValues(
  defs: CustomFieldDef[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) {
    const v = (values[d.field_key] ?? "").trim();
    if (v) out[d.field_key] = v;
  }
  return out;
}

/** Returns the label of the first required-but-empty field, else null. */
export function firstRequiredMissing(
  defs: CustomFieldDef[],
  values: Record<string, string>,
): string | null {
  for (const d of defs) {
    if (d.is_required && !(values[d.field_key] ?? "").trim()) return d.label;
  }
  return null;
}

/** Derive a stable snake_case field_key from a human label. */
export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
