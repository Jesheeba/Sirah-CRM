import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Exact-path public routes — no session, no exceptions.
const PUBLIC_EXACT = new Set(["/privacy", "/terms", "/data-deletion-status", "/unsubscribe"]);

// Prefix-matched public routes: machine/webhook endpoints hit with no browser session
// (Meta, WhatsApp providers, Razorpay, Vercel Cron, external landing pages, email
// clients) plus multi-segment public auth flows. Each of these either needs no
// verification (public content) or does its own — HMAC signature, verify_token,
// CRON_SECRET, or a per-record token in the path/query — inside the route handler.
// Exempting a route here is NOT the same as making it unauthenticated.
const PUBLIC_PREFIXES = [
  "/auth",
  "/join",
  "/api/invite/accept",
  "/api/email/open",
  "/api/email/click",
  "/api/whatsapp/webhook", // Meta Cloud API — legacy path
  "/api/whatsapp/device/", // UltraMsg inbound webhook (token in path)
  "/api/whatsapp/cloud/", // Meta Cloud API inbound webhook
  "/api/meta/leadgen", // Meta Lead Ads webhook
  "/api/meta/data-deletion", // Meta data-deletion callback (server-to-server)
  "/api/payments/razorpay/webhook/", // Razorpay server-to-server callback
  "/api/leads/capture", // web-to-lead capture, called from external landing pages
  "/api/sirahagents/", // sirahagents.com seller registration webhook
  "/api/calendar/ics", // iCal feed — authorized by its own ?token=, not a session
  "/api/workflows/tick", // Vercel Cron — authorized by CRON_SECRET inside the route
];

// Deliberately NOT public, despite being reached via an external redirect or looking
// machine-adjacent — each of these needs the initiating admin's own session:
//   /api/meta/oauth/callback, /api/meta/oauth/start — Facebook redirects the ADMIN'S
//     OWN browser back here after they click Connect while logged in; the session
//     cookie travels with that top-level redirect, and the route also has its own
//     getUserContext() guard as a backstop.
//   /api/workflows/event, /api/import/run, /api/import/errors, /api/reports/win-loss —
//     in-app authenticated features, never called by an external service.

function isPublicPath(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = path.startsWith("/login") || path.startsWith("/signup");
  const isPublic = isAuthPage || isPublicPath(path);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
