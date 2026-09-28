import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getUserContext } from "@/lib/auth";
import { appBaseUrl, buildOAuthUrl, metaConfigured, scopesForIntent, type MetaConnectIntent } from "@/lib/meta";

/**
 * Kicks off the Facebook Login OAuth flow. Admin-only (this route is NOT in the
 * public middleware allow-list). Sets a short-lived CSRF `state` cookie, then
 * redirects to Facebook's consent dialog.
 *
 * Redirects are built from `appBaseUrl()` (NEXT_PUBLIC_APP_URL), NOT `req.url` —
 * behind a tunnel/proxy (ngrok) the request URL resolves to the internal host
 * (https://localhost:PORT), which breaks the browser with an SSL error.
 *
 * `?intent=facebook|instagram` (default facebook) picks which scope set to request —
 * kept separate so requesting Instagram DM permissions the app doesn't have yet
 * (see lib/meta.ts) can't break the working "Connect Facebook" flow. The intent
 * rides along inside `state` (Facebook echoes it back verbatim) so the callback
 * knows which flow to run without a second cookie.
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

  const rawIntent = req.nextUrl.searchParams.get("intent");
  const intent: MetaConnectIntent = rawIntent === "instagram" ? "instagram" : "facebook";

  const state = `${crypto.randomUUID()}.${intent}`;
  const res = NextResponse.redirect(buildOAuthUrl(state, scopesForIntent(intent)));
  res.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
