import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/meta";
import { IG_SCOPES, exchangeIgCode, fetchAssignedIgAccounts, subscribeIgAccount } from "@/lib/ig-login";

/**
 * Unified Login callback: verifies the CSRF state, exchanges the code for the client's system-user
 * token, reads the Instagram accounts the client shared, and for each one that no other tenant has
 * connected stores it (service role) and subscribes it to comments / mentions / messages.
 * Admin-only. Always redirects back to Settings → Integrations with a short reason code.
 */
export async function GET(req: NextRequest) {
  const base = appBaseUrl();
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings/integrations?${q}`, base));
    res.cookies.delete("ig_oauth_state");
    return res;
  };

  const ctx = await getUserContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", base));
  if (!ctx.isAdmin || !ctx.tenantId) return NextResponse.redirect(new URL("/dashboard", base));

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("ig=error&reason=denied");

  const code = params.get("code");
  const state = params.get("state");
  const saved = req.cookies.get("ig_oauth_state")?.value;
  if (!code || !state || !saved || state !== saved) return back("ig=error&reason=state");

  try {
    const token = await exchangeIgCode(code);
    const accounts = await fetchAssignedIgAccounts(token.accessToken);
    if (!accounts.length) return back("ig=error&reason=noaccount");

    const admin = createAdminClient();
    let connected = 0;
    let taken = 0;
    let allSubscribed = true;
    for (const a of accounts) {
      const { data: existing } = await admin.from("ig_accounts").select("tenant_id").eq("ig_user_id", a.userId).maybeSingle();
      if (existing && existing.tenant_id !== ctx.tenantId) {
        taken++;
        continue;
      }
      let subscribed = false;
      try {
        subscribed = await subscribeIgAccount(a.userId, token.accessToken);
      } catch {
        subscribed = false; // stored anyway; the card says so and the admin can reconnect
      }
      if (!subscribed) allSubscribed = false;
      const { error } = await admin.from("ig_accounts").upsert(
        {
          tenant_id: ctx.tenantId,
          ig_user_id: a.userId,
          username: a.username,
          account_type: "BUSINESS",
          access_token: token.accessToken,
          token_expires_at: token.expiresAt,
          scopes: IG_SCOPES,
          status: "active",
          webhook_subscribed: subscribed,
          connected_by: ctx.userId,
        },
        { onConflict: "ig_user_id" },
      );
      if (!error) connected++;
    }
    if (!connected) return back(`ig=error&reason=${taken ? "taken" : "save"}`);
    return back(`ig=connected&subscribed=${allSubscribed ? 1 : 0}&accounts=${connected}`);
  } catch {
    return back("ig=error&reason=oauth");
  }
}
