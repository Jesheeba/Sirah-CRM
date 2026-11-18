import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getUserContext } from "@/lib/auth";
import { appBaseUrl } from "@/lib/meta";
import { buildIgAuthUrl, igConfigured } from "@/lib/ig-login";

/**
 * Starts "Connect Instagram" (Instagram Login — for accounts with no Facebook Page).
 * Admin-only; sets a short-lived CSRF `state` cookie and redirects to Instagram's consent
 * screen. Redirects use `appBaseUrl()`, never `req.url` (see api/meta/oauth/start).
 */
export async function GET() {
  const base = appBaseUrl();
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", base));
  if (!ctx.isAdmin) return NextResponse.redirect(new URL("/dashboard", base));
  if (!igConfigured()) {
    return NextResponse.redirect(new URL("/settings/integrations?ig=error&reason=unconfigured", base));
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildIgAuthUrl(state));
  res.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
