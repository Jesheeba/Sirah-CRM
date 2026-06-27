import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Workflow event bus — POST to trigger a named event (trigger_type='event')
 * from anywhere in the app. The caller supplies the event name and the record
 * payload; matching active workflows are enqueued into workflow_runs.
 *
 * Body: { event_name: string; entity_type: string; entity_id: string; record?: object }
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    event_name?: string;
    entity_type?: string;
    entity_id?: string;
    record?: Record<string, unknown>;
  } | null;

  if (!body?.event_name || !body?.entity_type || !body?.entity_id) {
    return NextResponse.json(
      { error: "event_name, entity_type, and entity_id are required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Find all active workflows for this tenant + entity that fire on this event name.
  const { data: workflows } = await admin
    .from("workflows")
    .select(`
      id,
      workflow_triggers!inner(trigger_type, config),
      workflow_actions(id, action_type, config, execution_order)
    `)
    .eq("tenant_id", ctx.tenantId)
    .eq("entity_type", body.entity_type)
    .eq("is_active", true)
    .is("deleted_at", null)
    .eq("workflow_triggers.trigger_type", "event")
    .filter("workflow_triggers.config->>event_name", "eq", body.event_name);

  if (!workflows?.length) {
    return NextResponse.json({ matched: 0 });
  }

  const insertions = workflows.flatMap((wf) =>
    (wf.workflow_actions ?? []).map((act) => ({
      tenant_id: ctx.tenantId,
      workflow_id: wf.id,
      status: "pending",
      context: {
        action_id: act.id,
        action_type: act.action_type,
        config: act.config,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        record: body.record ?? {},
      },
      scheduled_for: new Date().toISOString(),
    })),
  );

  if (!insertions.length) {
    return NextResponse.json({ matched: workflows.length, enqueued: 0 });
  }

  const { error } = await admin.from("workflow_runs").insert(insertions as never);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ matched: workflows.length, enqueued: insertions.length });
}
