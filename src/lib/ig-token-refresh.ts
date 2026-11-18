import type { SupabaseClient } from "@supabase/supabase-js";
import { needsRefresh, refreshIgToken } from "@/lib/ig-login";

export interface IgRefreshResult {
  checked: number;
  refreshed: number;
  expired: number;
  failed: number;
}

/**
 * Daily job (rides the workflows tick): extends Instagram Login tokens that are close to
 * their 60-day expiry. A token already past expiry cannot be refreshed — the account is
 * marked `expired` so the settings card asks the admin to reconnect, instead of the desk
 * silently going quiet. A transient failure inside the window is retried on the next tick.
 *
 * `refresh` and `now` are injectable so the decision logic is testable without the network.
 */
export async function processIgTokenRefresh(
  admin: SupabaseClient,
  deps: { refresh?: typeof refreshIgToken; now?: Date } = {},
): Promise<IgRefreshResult> {
  const refresh = deps.refresh ?? refreshIgToken;
  const now = deps.now ?? new Date();
  const out: IgRefreshResult = { checked: 0, refreshed: 0, expired: 0, failed: 0 };

  const { data } = await admin
    .from("ig_accounts")
    .select("id, access_token, token_expires_at")
    .eq("status", "active");

  for (const acc of (data ?? []) as { id: string; access_token: string; token_expires_at: string | null }[]) {
    if (!needsRefresh(acc.token_expires_at, now)) continue;
    out.checked++;

    const exp = acc.token_expires_at ? Date.parse(acc.token_expires_at) : NaN;
    if (!Number.isNaN(exp) && exp <= now.getTime()) {
      await admin.from("ig_accounts").update({ status: "expired" }).eq("id", acc.id);
      out.expired++;
      continue;
    }
    try {
      const next = await refresh(acc.access_token);
      await admin
        .from("ig_accounts")
        .update({ access_token: next.accessToken, token_expires_at: next.expiresAt })
        .eq("id", acc.id);
      out.refreshed++;
    } catch {
      out.failed++; // still inside the window — try again on the next tick
    }
  }
  return out;
}
