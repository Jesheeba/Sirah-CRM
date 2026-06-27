import { createClient } from "@/lib/supabase/server";
import WinLossClient from "@/components/reports/WinLossClient";

export const metadata = { title: "Win-Loss Analysis — Sirah CRM" };

export default async function WinLossPage() {
  const supabase = await createClient();

  // Default: last 90 days
  const to   = new Date();
  const from = new Date(to.getTime() - 90 * 86400_000);

  const { data } = await supabase.rpc("get_winloss_report", {
    from_date: from.toISOString(),
    to_date:   to.toISOString(),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Win-Loss Analysis</h1>
        <p className="text-sm text-slate-500">Why deals are won and lost across your team.</p>
      </div>
      <WinLossClient
        initialData={data as WinLossReport | null}
        defaultFrom={from.toISOString().slice(0, 10)}
        defaultTo={to.toISOString().slice(0, 10)}
      />
    </div>
  );
}

export interface WinLossReport {
  summary: {
    won: number;
    lost: number;
    total: number;
    win_rate: number | null;
    value_won: number;
    value_lost: number;
  };
  reasons: Array<{ reason: string; count: number; value: number }>;
  by_owner: Array<{
    owner_id: string;
    owner_name: string;
    won: number;
    lost: number;
    win_rate: number | null;
    value_won: number;
  }>;
}
