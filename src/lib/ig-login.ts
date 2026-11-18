/**
 * Connect an Instagram professional account through Meta's "Instagram API with Unified Login"
 * (MLA social desk, F1 — switched from the legacy Instagram Login on 2026-11-18 so @mentions
 * are available and one permission set serves Page-linked and Instagram-only clients).
 *
 * Facts from Meta's docs (instagram-api-with-unified-login/get-started + authentication):
 *  - login: www.facebook.com/dialog/oauth with the Meta app id and a Facebook Login for Business
 *    `config_id`; the client logs in with Instagram or Facebook; no Facebook Page needed;
 *  - the code is exchanged on graph.facebook.com with the Meta app id/secret and returns a
 *    Business Integration System User token whose lifetime is set in the configuration
 *    ("Never" by default) — so no 60-day refresh;
 *  - accounts come from /me/assigned_instagram_accounts; all calls use graph.facebook.com.
 *
 * Pure helpers are exported for unit tests; network calls never put a token in an error message.
 */
import { appBaseUrl } from "@/lib/meta";

/** Graph version used in Meta's Unified Login examples. */
export const IG_GRAPH = "v27.0";
export const IG_SCOPES = "instagram_basic,instagram_manage_comments,instagram_manage_messages";
export const IG_WEBHOOK_FIELDS = "comments,mentions,messages";
/** Refresh a token this long before it expires — only for configurations with an expiry. */
export const IG_REFRESH_WINDOW_DAYS = 10;

const metaAppId = () => process.env.META_APP_ID ?? "";
const metaAppSecret = () => process.env.META_APP_SECRET ?? "";
/** Facebook Login for Business configuration created under "API setup with Unified login". */
const igConfigId = () => process.env.IG_CONFIG_ID ?? "";

export function igConfigured(): boolean {
  return Boolean(metaAppId() && metaAppSecret() && igConfigId());
}

export function igRedirectUri(): string {
  return `${appBaseUrl()}/api/ig/oauth/callback`;
}

export const graphUrl = (path: string) => new URL(`https://graph.facebook.com/${IG_GRAPH}/${path}`);

export function buildIgAuthUrl(state: string): string {
  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", metaAppId());
  url.searchParams.set("config_id", igConfigId());
  url.searchParams.set("redirect_uri", igRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export function expiresAtFrom(expiresInSeconds: number, now: Date = new Date()): string {
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

/** True when the token is within the refresh window or already past expiry. Null = never expires. */
export function needsRefresh(
  expiresAt: string | null,
  now: Date = new Date(),
  windowDays = IG_REFRESH_WINDOW_DAYS,
): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - now.getTime() <= windowDays * 86_400_000;
}

export async function igJson(url: URL | string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error as { message?: string } | undefined;
  const msg = (json.error_message as string | undefined) ?? err?.message;
  if (!res.ok || err || json.error_type) throw new Error(msg ?? `Meta API error (HTTP ${res.status})`);
  return json;
}

/** `expires_in` of 0 / missing means the token does not expire (system-user token set to "Never"). */
export function tokenExpiry(json: Record<string, unknown>, now: Date = new Date()): string | null {
  const s = Number(json.expires_in);
  return Number.isFinite(s) && s > 0 ? expiresAtFrom(s, now) : null;
}

/** Exchange the OAuth `code` for the client's Business Integration System User token. */
export async function exchangeIgCode(code: string): Promise<{ accessToken: string; expiresAt: string | null }> {
  const url = graphUrl("oauth/access_token");
  url.searchParams.set("client_id", metaAppId());
  url.searchParams.set("client_secret", metaAppSecret());
  url.searchParams.set("redirect_uri", igRedirectUri());
  url.searchParams.set("code", code);
  const json = await igJson(url);
  if (typeof json.access_token !== "string" || !json.access_token) throw new Error("Meta did not return an access token.");
  return { accessToken: json.access_token, expiresAt: tokenExpiry(json) };
}

/** Refresh is only possible through Meta's token management API; until a configuration with an
 *  expiry is used this is never called (tokens default to "Never"). */
export async function refreshIgToken(token: string): Promise<{ accessToken: string; expiresAt: string }> {
  void token;
  throw new Error("This connection's token can't be renewed automatically — reconnect Instagram.");
}

export interface IgAccount {
  userId: string;
  username: string | null;
}

/** Instagram professional accounts the client shared during login (one login can share several). */
export async function fetchAssignedIgAccounts(token: string): Promise<IgAccount[]> {
  const out: IgAccount[] = [];
  let url: URL | null = graphUrl("me/assigned_instagram_accounts");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", token);
  for (let page = 0; url && page < 10; page++) {
    const j = await igJson(url);
    for (const a of (j.data ?? []) as { id?: unknown; username?: unknown }[]) {
      if (a.id) out.push({ userId: String(a.id), username: typeof a.username === "string" ? a.username : null });
    }
    const next = (j.paging as { next?: string } | undefined)?.next;
    url = next ? new URL(next) : null;
  }
  return out;
}

export async function subscribeIgAccount(igUserId: string, token: string): Promise<boolean> {
  const url = graphUrl(`${igUserId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", IG_WEBHOOK_FIELDS);
  url.searchParams.set("access_token", token);
  const json = await igJson(url, { method: "POST" });
  return json.success === true;
}

export async function unsubscribeIgAccount(igUserId: string, token: string): Promise<void> {
  const url = graphUrl(`${igUserId}/subscribed_apps`);
  url.searchParams.set("access_token", token);
  await igJson(url, { method: "DELETE" });
}
