import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  appBaseUrl,
  exchangeCodeForUserToken,
  getLongLivedUserToken,
  listPages,
  subscribePageToLeadgen,
} from "@/lib/meta";

/**
 * OAuth callback. Verifies the CSRF state, exchanges the code for a long-lived user
 * token, lists the user's Pages, and (service role) stores each Page + its token and
 * subscribes it to the leadgen webhook. Admin-only. Redirects back to the settings page.
 */
export async function GET(req: NextRequest) {
  // Build redirects from the public base URL, never req.url — behind ngrok the
  // request host resolves to https://localhost:PORT and breaks the browser (SSL error).
  const base = appBaseUrl();
  const redirectBack = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings/integrations?${q}`, base));
    res.cookies.delete("meta_oauth_state");
    return res;
  };

  const ctx = await getUserContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", base));
  if (!ctx.isAdmin || !ctx.tenantId) return NextResponse.redirect(new URL("/dashboard", base));

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return redirectBack("meta=error&reason=denied");

  const code = params.get("code");
  const state = params.get("state");
  const savedState = req.cookies.get("meta_oauth_state")?.value;
  if (!code || !state || !savedState || state !== savedState) {
    return redirectBack("meta=error&reason=state");
  }

  try {
    const shortToken = await exchangeCodeForUserToken(code);
    const userToken = await getLongLivedUserToken(shortToken);
    const pages = await listPages(userToken);
    if (!pages.length) return redirectBack("meta=error&reason=nopages");

    const admin = createAdminClient();
    let connected = 0;
    for (const page of pages) {
      let subscribed = false;
      try {
        subscribed = await subscribePageToLeadgen(page.id, page.access_token);
      } catch {
        subscribed = false; // store the page anyway; admin can retry / the page may already be subscribed
      }
      const { error } = await admin.from("meta_lead_pages").upsert(
        {
          tenant_id: ctx.tenantId,
          page_id: page.id,
          page_name: page.name,
          access_token: page.access_token,
          is_enabled: true,
          subscribed,
          connected_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "page_id" },
      );
      if (!error) connected++;
    }
    if (!connected) return redirectBack("meta=error&reason=save");
    return redirectBack(`meta=connected&pages=${connected}`);
  } catch {
    return redirectBack("meta=error&reason=oauth");
  }
}
