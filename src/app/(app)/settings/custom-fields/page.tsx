import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import CustomFieldsClient from "@/components/settings/CustomFieldsClient";
import type { CustomFieldDef } from "@/lib/types";

export default async function CustomFieldsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only

  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_definitions")
    .select("id, entity_type, field_key, label, data_type, options, is_required, display_order")
    .order("entity_type")
    .order("display_order");

  const defs: CustomFieldDef[] = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    field_key: r.field_key,
    label: r.label,
    data_type: r.data_type,
    options: Array.isArray(r.options) ? r.options : null,
    is_required: !!r.is_required,
    display_order: r.display_order ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Custom Fields</h1>
        <p className="text-sm text-slate-500">
          Define extra fields that appear on your records. They show up on record pages and in the
          “new record” forms for everyone in your organization.
        </p>
      </div>
      <CustomFieldsClient initialDefs={defs} />
    </div>
  );
}
