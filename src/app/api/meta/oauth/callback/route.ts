import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  appBaseUrl,
  exchangeCodeForUserToken,
  fetchInstagramBusinessAccount,
  fetchMetaUserId,
  getLongLivedUserToken,
  listPages,
  subscribePageToLeadgen,
  subscribePageToMessages,
  subscribePageToComments,
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
  // Intent rides inside `state` as "<uuid>.<intent>" (see oauth/start/route.ts) — safe to
  // trust once `state === savedState` has already been verified as a CSRF check above.
  const intent = state.endsWith(".instagram") ? "instagram" : "facebook";
  const via = `&via=${intent}`;

  try {
    const shortToken = await exchangeCodeForUserToken(code);
    const userToken = await getLongLivedUserToken(shortToken);
    const pages = await listPages(userToken);
    if (!pages.length) return redirectBack(`meta=error&reason=nopages${via}`);

    // Best-effort — same Facebook user owns every page from this OAuth grant, so
    // resolve it once. Used only to map a future Meta data-deletion request back to
    // these connections; a null here never blocks connecting the pages.
    const fbUserId = await fetchMetaUserId(userToken);

    const admin = createAdminClient();
    let connected = 0;
    for (const page of pages) {
      if (intent === "facebook") {
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
            fb_user_id: fbUserId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "page_id" },
        );
        if (!error) connected++;
        continue;
      }

      // Instagram intent: only store pages that actually have a linked Instagram
      // Business Account — this OAuth grant doesn't touch leadgen at all (no
      // `is_enabled`/`subscribed` columns here, so an existing Facebook connection
      // for the same page is left untouched on conflict).
      const igBusinessId = await fetchInstagramBusinessAccount(page.id, page.access_token);
      if (!igBusinessId) continue;
      try {
        await subscribePageToMessages(page.id, page.access_token);
      } catch {
        // non-fatal — page still gets stored; admin can retry via the settings UI
      }
      try {
        await subscribePageToComments(page.id, page.access_token);
      } catch {
        // non-fatal — comment automation stays available to turn on later
      }
      const { error } = await admin.from("meta_lead_pages").upsert(
        {
          tenant_id: ctx.tenantId,
          page_id: page.id,
          page_name: page.name,
          access_token: page.access_token,
          connected_by: ctx.userId,
          fb_user_id: fbUserId,
          ig_business_id: igBusinessId,
          ig_dm_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "page_id" },
      );
      if (!error) connected++;
    }
    if (!connected) {
      return redirectBack(
        `meta=error&reason=${intent === "instagram" ? "noig" : "save"}${via}`,
      );
    }
    return redirectBack(`meta=connected&pages=${connected}${via}`);
  } catch {
    return redirectBack(`meta=error&reason=oauth${via}`);
  }
}
