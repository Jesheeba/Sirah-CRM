import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/meta";
import { deleteIgUserData, verifyIgSignedRequest } from "@/lib/ig-data-deletion";

export const runtime = "nodejs";

/**
 * Instagram Login "Data deletion request" callback. Deletes the account's social-desk data inline
 * (it is small and cascades in one statement), records a completed request so the shared
 * /data-deletion-status page can confirm it, and answers with Meta's {url, confirmation_code}.
 */
export async function POST(req: NextRequest) {
  let sr: string | null = null;
  try {
    const type = req.headers.get("content-type") ?? "";
    sr = type.includes("application/json")
      ? ((await req.json()) as { signed_request?: string }).signed_request ?? null
      : new URLSearchParams(await req.text()).get("signed_request");
  } catch {
    sr = null;
  }
  const verified = sr ? verifyIgSignedRequest(sr) : null;
  if (!verified) return NextResponse.json({ error: "invalid_signed_request" }, { status: 400 });

  const admin = createAdminClient();
  try {
    await deleteIgUserData(admin, verified.user_id);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  const code = randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  await admin.from("meta_deletion_requests").insert({
    facebook_uid: `ig:${verified.user_id}`,
    code,
    status: "completed",
    issued_at: verified.issued_at ? new Date(verified.issued_at * 1000).toISOString() : null,
    requested_at: now,
    completed_at: now,
  });
  return NextResponse.json({ url: `${appBaseUrl()}/data-deletion-status?code=${code}`, confirmation_code: code });
}
