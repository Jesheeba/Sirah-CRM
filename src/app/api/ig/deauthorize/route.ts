import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revokeIgUser, verifyIgSignedRequest } from "@/lib/ig-data-deletion";

export const runtime = "nodejs";

async function readSignedRequest(req: NextRequest): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) return ((await req.json()) as { signed_request?: string }).signed_request ?? null;
    return new URLSearchParams(await req.text()).get("signed_request");
  } catch {
    return null;
  }
}

/** Instagram Login "Deauthorize callback": the account owner removed the app — stop using the account now. */
export async function POST(req: NextRequest) {
  const sr = await readSignedRequest(req);
  const verified = sr ? verifyIgSignedRequest(sr) : null;
  if (!verified) return NextResponse.json({ error: "invalid_signed_request" }, { status: 400 });
  await revokeIgUser(createAdminClient(), verified.user_id);
  return NextResponse.json({ ok: true });
}
