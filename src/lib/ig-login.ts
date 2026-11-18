/**
 * "Instagram API with Instagram Login" helpers — the connect flow for an Instagram
 * professional account that has no Facebook Page (MLA social desk, feature F1).
 *
 * Separate from lib/meta.ts on purpose: different app credentials (the Instagram app id /
 * secret from the app's Instagram product), different hosts (instagram.com /
 * graph.instagram.com) and different permission names (`instagram_business_*`).
 *
 * Pure helpers (URL building, token parsing, expiry maths) are exported for unit tests;
 * network calls never put a token in an error message.
 */
import { GRAPH, appBaseUrl } from "@/lib/meta";

export const IG_SCOPES =
  "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages";
export const IG_WEBHOOK_FIELDS = "comments,mentions,messages";
/** Refresh a long-lived token this long before it expires (it lasts ~60 days). */
export const IG_REFRESH_WINDOW_DAYS = 10;
/** Only professional accounts can use the Instagram Login API. */
const PROFESSIONAL = new Set(["BUSINESS", "MEDIA_CREATOR"]);

const igAppId = () => process.env.IG_APP_ID ?? "";
const igAppSecret = () => process.env.IG_APP_SECRET ?? "";

export function igConfigured(): boolean {
  return Boolean(igAppId() && igAppSecret());
}

export function igRedirectUri(): string {
  return `${appBaseUrl()}/api/ig/oauth/callback`;
}

export function buildIgAuthUrl(state: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", igAppId());
  url.searchParams.set("redirect_uri", igRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", IG_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

export function isProfessionalAccount(accountType: string | null | undefined): boolean {
  return PROFESSIONAL.has((accountType ?? "").toUpperCase());
}

/** The code exchange answers either `{access_token,user_id}` or `{data:[{access_token,user_id}]}`. */
export function parseShortToken(json: unknown): { accessToken: string; userId: string } | null {
  const j = json as { access_token?: unknown; user_id?: unknown; data?: unknown[] } | null;
  const row = (Array.isArray(j?.data) ? j!.data[0] : j) as { access_token?: unknown; user_id?: unknown } | undefined;
  if (!row || typeof row.access_token !== "string" || !row.access_token) return null;
  return { accessToken: row.access_token, userId: row.user_id != null ? String(row.user_id) : "" };
}

export function expiresAtFrom(expiresInSeconds: number, now: Date = new Date()): string {
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

/** True when the token is within the refresh window (or already past expiry / unknown). */
export function needsRefresh(
  expiresAt: string | null,
  now: Date = new Date(),
  windowDays = IG_REFRESH_WINDOW_DAYS,
): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - now.getTime() <= windowDays * 86_400_000;
}

export async function igJson(url: URL | string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error as { message?: string } | undefined;
  const msg = (json.error_message as string | undefined) ?? err?.message;
  if (!res.ok || err || json.error_type) throw new Error(msg ?? `Instagram API error (HTTP ${res.status})`);
  return json;
}

/** Exchange the OAuth `code` for a short-lived Instagram user token. */
export async function exchangeIgCode(code: string): Promise<{ accessToken: string; userId: string }> {
  const body = new URLSearchParams({
    client_id: igAppId(),
    client_secret: igAppSecret(),
    grant_type: "authorization_code",
    redirect_uri: igRedirectUri(),
    code,
  });
  const json = await igJson("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const parsed = parseShortToken(json);
  if (!parsed) throw new Error("Instagram did not return an access token.");
  return parsed;
}

/** Short-lived → long-lived (≈60 days). */
export async function getLongLivedIgToken(shortToken: string): Promise<{ accessToken: string; expiresAt: string }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", igAppSecret());
  url.searchParams.set("access_token", shortToken);
  const json = await igJson(url);
  if (typeof json.access_token !== "string") throw new Error("Instagram did not return a long-lived token.");
  return { accessToken: json.access_token, expiresAt: expiresAtFrom(Number(json.expires_in) || 60 * 86_400) };
}

/** Extend a still-valid long-lived token (must be ≥24 h old). */
export async function refreshIgToken(token: string): Promise<{ accessToken: string; expiresAt: string }> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const json = await igJson(url);
  if (typeof json.access_token !== "string") throw new Error("Instagram did not return a refreshed token.");
  return { accessToken: json.access_token, expiresAt: expiresAtFrom(Number(json.expires_in) || 60 * 86_400) };
}

export interface IgProfile {
  userId: string;
  username: string | null;
  accountType: string | null;
}

export async function fetchIgProfile(token: string): Promise<IgProfile> {
  const url = new URL(`https://graph.instagram.com/${GRAPH}/me`);
  url.searchParams.set("fields", "user_id,username,account_type");
  url.searchParams.set("access_token", token);
  const j = await igJson(url);
  return {
    userId: String(j.user_id ?? j.id ?? ""),
    username: typeof j.username === "string" ? j.username : null,
    accountType: typeof j.account_type === "string" ? j.account_type : null,
  };
}

export async function subscribeIgAccount(token: string): Promise<boolean> {
  const url = new URL(`https://graph.instagram.com/${GRAPH}/me/subscribed_apps`);
  url.searchParams.set("subscribed_fields", IG_WEBHOOK_FIELDS);
  url.searchParams.set("access_token", token);
  const json = await igJson(url, { method: "POST" });
  return json.success === true;
}

export async function unsubscribeIgAccount(token: string): Promise<void> {
  const url = new URL(`https://graph.instagram.com/${GRAPH}/me/subscribed_apps`);
  url.searchParams.set("access_token", token);
  await igJson(url, { method: "DELETE" });
}
