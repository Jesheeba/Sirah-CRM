import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FALLBACK = "/";

/** Only ever redirect to http(s) — blocks javascript:/data: etc. from a malformed `u`. */
function safeRedirectTarget(raw: string | null): string {
  if (!raw) return FALLBACK;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return FALLBACK;
    return url.toString();
  } catch {
    return FALLBACK;
  }
}

/**
 * Email click-tracking redirect. Hit by (logged-out) recipients clicking a link inside
 * a sent email, so it's public (allow-listed in middleware) and logs via a SECURITY
 * DEFINER RPC — same open_token scheme as the open-tracking pixel (api/email/open).
 * Always 302s somewhere, even with a missing/invalid token or url, so a broken tracking
 * link never strands the recipient.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const target = safeRedirectTarget(req.nextUrl.searchParams.get("u"));

  if (token) {
    try {
      const supabase = await createClient();
      await supabase.rpc("fn_email_track_click", { p_token: token });
    } catch {
      // never let tracking failures block the redirect
    }
  }

  return NextResponse.redirect(target, { status: 302 });
}
