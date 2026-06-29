import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/import/errors?job_id=XXX
 * Returns a CSV of error rows for download.
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jobId = req.nextUrl.searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "job_id required." }, { status: 400 });

  const supabase = await createClient();

  const { data: errors } = await supabase
    .from("import_errors")
    .select("row_index, row_data, error")
    .eq("job_id", jobId)
    .order("row_index");

  if (!errors?.length) {
    return new NextResponse("row_index,error\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="import_errors_${jobId.slice(0,8)}.csv"`,
      },
    });
  }

  // Build CSV: all row_data keys + error column
  const allKeys = Array.from(
    new Set(errors.flatMap((e) => Object.keys((e.row_data as Record<string,string>) ?? {})))
  );
  const header = ["row_index", ...allKeys, "error"].map(q).join(",");
  const csvRows = errors.map((e) => {
    const rd = (e.row_data as Record<string,string>) ?? {};
    return [e.row_index, ...allKeys.map((k) => rd[k] ?? ""), e.error].map(q).join(",");
  });

  const csv = [header, ...csvRows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="import_errors_${jobId.slice(0,8)}.csv"`,
    },
  });
}

function q(v: unknown): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}
