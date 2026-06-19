import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * Email open-tracking pixel. Hit by (logged-out) recipients, so it's public
 * (allow-listed in middleware) and updates via a SECURITY DEFINER RPC.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (token) {
    try {
      const supabase = await createClient();
      await supabase.rpc("fn_email_track_open", { p_token: token });
    } catch {
      // never let tracking failures break image loading
    }
  }
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Content-Length": String(PIXEL.length),
    },
  });
}
