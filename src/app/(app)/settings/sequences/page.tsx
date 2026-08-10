import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext } from "@/lib/auth";
import SequencesClient from "./SequencesClient";
import type { Sequence, SequenceStep } from "@/lib/types";

export default async function SequencesPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/settings/branding");

  const admin = createAdminClient();

  const [{ data: sequencesData }, { data: stepsData }] = await Promise.all([
    admin.from("sequences").select("*").eq("tenant_id", ctx.tenantId!).is("deleted_at", null).order("created_at"),
    admin.from("sequence_steps").select("*").eq("tenant_id", ctx.tenantId!).order("step_order"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Sequences</h1>
        <p className="text-sm text-slate-500">
          Multi-step follow-up cadences — email, WhatsApp, or a task — enrolled per lead from the
          lead detail page. A sequence stops automatically when the lead replies or changes status.
        </p>
      </div>

      <SequencesClient initialSequences={(sequencesData ?? []) as Sequence[]} initialSteps={(stepsData ?? []) as SequenceStep[]} />
    </div>
  );
}
