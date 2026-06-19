import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import ReportsClient from "@/components/reports/ReportsClient";
import type { Member } from "@/components/tasks/TasksClient";
import type { SavedReport } from "@/lib/types";

export default async function ReportsPage() {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;

  const [membersRes, savedRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    supabase.from("saved_reports").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Reports</h1>
        <p className="text-sm text-slate-500">
          Filter and export your CRM data. {ctx.isRep ? "Showing your own records." : "Org-wide."}
        </p>
      </div>
      <ReportsClient
        members={(membersRes.data ?? []) as Member[]}
        savedReports={(savedRes.data ?? []) as SavedReport[]}
        userId={ctx.userId}
        canSeeAll={ctx.isManager || ctx.isAdmin}
      />
    </div>
  );
}
