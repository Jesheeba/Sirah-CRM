import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getUserContext } from "@/lib/auth";
import { appBaseUrl, buildOAuthUrl, metaConfigured } from "@/lib/meta";

/**
 * Kicks off the Facebook Login OAuth flow. Admin-only (this route is NOT in the
 * public middleware allow-list). Sets a short-lived CSRF `state` cookie, then
 * redirects to Facebook's consent dialog.
 *
 * Redirects are built from `appBaseUrl()` (NEXT_PUBLIC_APP_URL), NOT `req.url` —
 * behind a tunnel/proxy (ngrok) the request URL resolves to the internal host
 * (https://localhost:PORT), which breaks the browser with an SSL error.
 */
export async function GET(req: NextRequest) {
  const base = appBaseUrl();
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", base));
  if (!ctx.isAdmin) return NextResponse.redirect(new URL("/dashboard", base));
  if (!metaConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/integrations?meta=error&reason=unconfigured", base),
    );
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildOAuthUrl(state));
  res.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
