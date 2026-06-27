import Link from "next/link";
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
      {/* Analytics sub-reports */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/reports/win-loss"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand hover:shadow-sm transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 text-lg">
            📊
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">Win-Loss Analysis</p>
            <p className="text-xs text-slate-400">Why deals are won and lost</p>
          </div>
        </Link>
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
