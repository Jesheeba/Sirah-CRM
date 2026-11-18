import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/meta";
import {
  IG_SCOPES,
  exchangeIgCode,
  fetchIgProfile,
  getLongLivedIgToken,
  isProfessionalAccount,
  subscribeIgAccount,
} from "@/lib/ig-login";

/**
 * Instagram Login callback: verifies the CSRF state, exchanges the code, upgrades to a
 * long-lived token, checks the account is a professional account that no other tenant has
 * connected, stores it (service role) and subscribes it to comments/mentions/messages.
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

  const code = params.get("code")?.replace(/#_$/, ""); // Instagram appends "#_" to the code
  const state = params.get("state");
  const saved = req.cookies.get("ig_oauth_state")?.value;
  if (!code || !state || !saved || state !== saved) return back("ig=error&reason=state");

  try {
    const short = await exchangeIgCode(code);
    const long = await getLongLivedIgToken(short.accessToken);
    const profile = await fetchIgProfile(long.accessToken);
    if (!profile.userId) return back("ig=error&reason=oauth");
    if (!isProfessionalAccount(profile.accountType)) return back("ig=error&reason=personal");

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("ig_accounts")
      .select("tenant_id")
      .eq("ig_user_id", profile.userId)
      .maybeSingle();
    if (existing && existing.tenant_id !== ctx.tenantId) return back("ig=error&reason=taken");

    let subscribed = false;
    try {
      subscribed = await subscribeIgAccount(long.accessToken);
    } catch {
      subscribed = false; // stored anyway; the settings card shows it and the admin can reconnect
    }

    const { error } = await admin.from("ig_accounts").upsert(
      {
        tenant_id: ctx.tenantId,
        ig_user_id: profile.userId,
        username: profile.username,
        account_type: profile.accountType,
        access_token: long.accessToken,
        token_expires_at: long.expiresAt,
        scopes: IG_SCOPES,
        status: "active",
        webhook_subscribed: subscribed,
        connected_by: ctx.userId,
      },
      { onConflict: "ig_user_id" },
    );
    if (error) return back("ig=error&reason=save");
    return back(`ig=connected&subscribed=${subscribed ? 1 : 0}`);
  } catch {
    return back("ig=error&reason=oauth");
  }
}
