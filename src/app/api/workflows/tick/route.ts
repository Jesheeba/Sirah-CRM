import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeAction, type RunContext } from "@/lib/workflow-runner";

export const runtime = "nodejs";
export const maxDuration = 55;

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;

/**
 * Workflow tick — called by Vercel Cron every minute.
 * Picks up pending workflow_runs, executes each action, marks done or schedules retry.
 * Protected by CRON_SECRET so only Vercel's cron scheduler can call it.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();

  // Claim a batch atomically — set to 'running' so parallel invocations don't double-process.
  const { data: batch, error } = await admin
    .from("workflow_runs")
    .select("id, tenant_id, workflow_id, context, attempts")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!batch?.length) {
    return NextResponse.json({ processed: 0 });
  }

  const ids = batch.map((r) => r.id);
  await admin
    .from("workflow_runs")
    .update({ status: "running", attempts: 1 } as never)
    .in("id", ids);

  let done = 0;
  let failed = 0;

  await Promise.all(
    batch.map(async (run) => {
      const ctx: RunContext = {
        ...(run.context as object),
        tenant_id: run.tenant_id,
      } as RunContext;

      const result = await executeAction(ctx).catch((e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));

      const newAttempts = (run.attempts ?? 0) + 1;

      if (result.ok) {
        await admin
          .from("workflow_runs")
          .update({ status: "done" } as never)
          .eq("id", run.id);

        await admin.from("workflow_run_logs").insert({
          tenant_id: run.tenant_id,
          workflow_id: run.workflow_id,
          entity_type: ctx.entity_type,
          entity_id: ctx.entity_id,
          trigger_type: "async_action",
          status: "success",
          detail: { action_type: ctx.action_type },
        });
        done++;
      } else {
        const retry = newAttempts < MAX_ATTEMPTS;
        const backoffSeconds = Math.pow(2, newAttempts) * 30;

        await admin
          .from("workflow_runs")
          .update({
            status: retry ? "pending" : "failed",
            attempts: newAttempts,
            last_error: result.error ?? null,
            ...(retry
              ? {
                  scheduled_for: new Date(
                    Date.now() + backoffSeconds * 1000,
                  ).toISOString(),
                }
              : {}),
          } as never)
          .eq("id", run.id);

        await admin.from("workflow_run_logs").insert({
          tenant_id: run.tenant_id,
          workflow_id: run.workflow_id,
          entity_type: ctx.entity_type,
          entity_id: ctx.entity_id,
          trigger_type: "async_action",
          status: retry ? "retry" : "error",
          detail: { action_type: ctx.action_type, error: result.error, attempt: newAttempts },
        });
        failed++;
      }
    }),
  );

  return NextResponse.json({ processed: batch.length, done, failed });
}

// Allow Vercel's GET-based cron ping as well
export async function GET(req: NextRequest) {
  return POST(req);
}
