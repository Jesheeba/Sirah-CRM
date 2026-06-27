import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 90 * 86400_000).toISOString();
  const to   = searchParams.get("to")   ?? new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_winloss_report", {
    from_date: from,
    to_date:   to,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
