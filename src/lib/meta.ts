import crypto from "node:crypto";

/**
 * Server-only helpers for the Meta (Facebook/Instagram) Lead Ads integration:
 * OAuth token exchange, Graph API calls, webhook signature verification, and
 * form-field → CRM-lead mapping.
 *
 * Reads app-level secrets (META_APP_SECRET) — must never run in the browser. The
 * card UI imports only the `MetaLeadPage` type + server actions, never this module.
 */
if (typeof window !== "undefined") {
  throw new Error("lib/meta.ts is server-only and must not be imported in the browser.");
}

/** Pinned Graph API version (one place to bump). */
export const GRAPH = "v21.0";

/** Permissions requested during "Connect Facebook" — enough to read pages + retrieve leads.
 *  `pages_manage_ads` lets us enumerate a page's lead forms (used for verification /
 *  optional backfill); the webhook itself only needs `leads_retrieval`.
 *
 *  Kept separate from META_SCOPES_INSTAGRAM: `instagram_manage_messages`/`pages_messaging`
 *  require the app to have those permissions added under Permissions and features in the
 *  Meta dashboard, or the Facebook Login dialog rejects the ENTIRE scope string with
 *  "Invalid Scopes" and blocks Connect Facebook too. Two OAuth entry points let an admin
 *  connect Lead Ads without Instagram DM ever being approved. */
export const META_SCOPES_FACEBOOK =
  "pages_show_list,pages_manage_metadata,leads_retrieval,pages_read_engagement,business_management,pages_manage_ads";

/** Permissions requested during "Connect Instagram" — covers Instagram DM automation.
 *  `pages_show_list` is needed to re-list the user's Pages and find which one has a
 *  linked Instagram Business Account. */
export const META_SCOPES_INSTAGRAM =
  "pages_show_list,instagram_basic,instagram_manage_messages,instagram_manage_comments";

export type MetaConnectIntent = "facebook" | "instagram";

export function scopesForIntent(intent: MetaConnectIntent): string {
  return intent === "instagram" ? META_SCOPES_INSTAGRAM : META_SCOPES_FACEBOOK;
}

const appId = () => process.env.META_APP_ID ?? "";
const appSecret = () => process.env.META_APP_SECRET ?? "";

/** True when the deployment has a Meta app configured (gate the Connect button). */
export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

/** Token Meta echoes back during the webhook verification handshake. */
export function metaVerifyToken(): string {
  return process.env.META_VERIFY_TOKEN ?? "";
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Must EXACTLY match a "Valid OAuth Redirect URI" in the Meta app settings. */
export function getRedirectUri(): string {
  return `${appBaseUrl()}/api/meta/oauth/callback`;
}

/** Facebook Login dialog URL the admin is redirected to. */
export function buildOAuthUrl(state: string, scopes: string): string {
  const url = new URL(`https://www.facebook.com/${GRAPH}/dialog/oauth`);
  url.searchParams.set("client_id", appId());
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("scope", scopes);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

// ---- Graph API ---------------------------------------------------------------

type Params = Record<string, string | undefined>;

async function graphFetch(path: string, params: Params, init?: RequestInit): Promise<Record<string, unknown>> {
  const url = new URL(`https://graph.facebook.com/${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error as { message?: string } | undefined;
  if (!res.ok || err) throw new Error(err?.message ?? `Graph API error (HTTP ${res.status})`);
  return json;
}

/** Exchange the OAuth `code` for a short-lived user access token. */
export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const json = await graphFetch("oauth/access_token", {
    client_id: appId(),
    client_secret: appSecret(),
    redirect_uri: getRedirectUri(),
    code,
  });
  return String(json.access_token ?? "");
}

/** Upgrade a short-lived user token to a long-lived (~60-day) one. */
export async function getLongLivedUserToken(shortToken: string): Promise<string> {
  const json = await graphFetch("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId(),
    client_secret: appSecret(),
    fb_exchange_token: shortToken,
  });
  return String(json.access_token ?? "");
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

/** Resolve the Facebook app-scoped user id for an access token — captured at connection
 *  time (both Lead Ads OAuth and WhatsApp Embedded Signup) so a later Meta data-deletion
 *  callback (which only identifies the user by this id) can be mapped back to what they
 *  connected. Best-effort: returns null on failure rather than failing the whole connect,
 *  matching the non-fatal pattern used for the other post-token Graph calls in this flow. */
export async function fetchMetaUserId(accessToken: string): Promise<string | null> {
  try {
    const json = await graphFetch("me", { access_token: accessToken, fields: "id" });
    return typeof json.id === "string" ? json.id : null;
  } catch {
    return null;
  }
}

/** List the Pages the user manages, each with its own (long-lived) Page token. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const json = await graphFetch("me/accounts", {
    access_token: userToken,
    fields: "id,name,access_token",
    limit: "100",
  });
  const data = (json.data ?? []) as Array<{ id?: string; name?: string; access_token?: string }>;
  return data
    .filter((p) => p.id && p.access_token)
    .map((p) => ({ id: p.id!, name: p.name ?? "", access_token: p.access_token! }));
}

/** Subscribe a Page to the app's `leadgen` webhook field. */
export async function subscribePageToLeadgen(pageId: string, pageToken: string): Promise<boolean> {
  const json = await graphFetch(
    `${pageId}/subscribed_apps`,
    { subscribed_fields: "leadgen", access_token: pageToken },
    { method: "POST" },
  );
  return Boolean(json.success);
}

/** Remove the app's webhook subscription from a Page (on disconnect). */
export async function unsubscribePage(pageId: string, pageToken: string): Promise<boolean> {
  const json = await graphFetch(
    `${pageId}/subscribed_apps`,
    { access_token: pageToken },
    { method: "DELETE" },
  );
  return Boolean(json.success);
}

/** Subscribe a Page to the `messages` field (Instagram DM delivery via the same Page webhook object). */
export async function subscribePageToMessages(pageId: string, pageToken: string): Promise<boolean> {
  const json = await graphFetch(
    `${pageId}/subscribed_apps`,
    { subscribed_fields: "messages", access_token: pageToken },
    { method: "POST" },
  );
  return Boolean(json.success);
}

/** Subscribe a Page to the `feed` field. For an Instagram account linked via classic
 *  Facebook Login for Business (as opposed to native Instagram API with Instagram
 *  Login), comment events on Instagram posts/reels are delivered through the Page's
 *  `feed` field, not a `comments` field — the Page object's subscribed_apps edge
 *  doesn't even recognize `"comments"` as a valid field name. */
export async function subscribePageToComments(pageId: string, pageToken: string): Promise<boolean> {
  const json = await graphFetch(
    `${pageId}/subscribed_apps`,
    { subscribed_fields: "feed", access_token: pageToken },
    { method: "POST" },
  );
  return Boolean(json.success);
}

/** Resolve the Instagram Business Account linked to a Page, if any. Best-effort:
 *  most pages have no linked IG account, which is a normal, non-fatal case. */
export async function fetchInstagramBusinessAccount(pageId: string, pageToken: string): Promise<string | null> {
  try {
    const json = await graphFetch(pageId, {
      access_token: pageToken,
      fields: "instagram_business_account",
    });
    const ig = json.instagram_business_account as { id?: string } | undefined;
    return ig?.id ?? null;
  } catch {
    return null;
  }
}

export interface MetaLeadDetail {
  field_data: Array<{ name: string; values: string[] }>;
  platform?: string;
  ad_id?: string;
  form_id?: string;
  created_time?: string;
}

/** Fetch the actual answers for a leadgen id using the Page token. */
export async function fetchLeadDetail(leadgenId: string, pageToken: string): Promise<MetaLeadDetail> {
  const json = await graphFetch(leadgenId, {
    access_token: pageToken,
    fields: "field_data,created_time,ad_id,form_id,platform",
  });
  return {
    field_data: (json.field_data ?? []) as MetaLeadDetail["field_data"],
    platform: json.platform as string | undefined,
    ad_id: json.ad_id as string | undefined,
    form_id: json.form_id as string | undefined,
    created_time: json.created_time as string | undefined,
  };
}

// ---- Field mapping -----------------------------------------------------------

const STANDARD = new Set(["email", "phone_number", "first_name", "last_name", "full_name", "company_name"]);

export interface MappedLead {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  /** Non-standard form answers, keyed by the Meta field name. */
  answers: Record<string, string>;
  source: string;
}

/**
 * Auto-map a Meta instant-form submission onto CRM lead fields. Standard questions
 * map to columns; every other answer is returned in `answers` for custom_fields.
 */
export function mapLead(detail: MetaLeadDetail): MappedLead {
  const get = (name: string): string | null => {
    const f = detail.field_data.find((x) => x.name === name);
    const v = f?.values?.[0]?.trim();
    return v ? v : null;
  };

  let first = get("first_name");
  let last = get("last_name");
  if (!first && !last) {
    const full = get("full_name");
    if (full) {
      const parts = full.split(/\s+/);
      first = parts[0] ?? null;
      last = parts.length > 1 ? parts.slice(1).join(" ") : null;
    }
  }

  const answers: Record<string, string> = {};
  for (const f of detail.field_data) {
    if (STANDARD.has(f.name)) continue;
    const v = f.values?.[0]?.trim();
    if (v) answers[f.name] = v;
  }

  return {
    first_name: first,
    last_name: last,
    email: get("email"),
    phone: get("phone_number"),
    company: get("company_name"),
    answers,
    source: detail.platform === "ig" ? "Instagram Lead Ads" : "Facebook Lead Ads",
  };
}

// ---- Historical backfill helpers ---------------------------------------------

export interface MetaLeadForm {
  id: string;
  name: string;
}

/** List all lead-gen forms for a Page (cursor-paginated). */
export async function fetchPageForms(pageId: string, pageToken: string): Promise<MetaLeadForm[]> {
  const forms: MetaLeadForm[] = [];
  let after: string | undefined;
  do {
    const json = await graphFetch(`${pageId}/leadgen_forms`, {
      access_token: pageToken,
      fields: "id,name",
      limit: "100",
      after,
    });
    const data = (json.data ?? []) as Array<{ id?: string; name?: string }>;
    forms.push(...data.filter((f) => f.id).map((f) => ({ id: f.id!, name: f.name ?? "" })));
    const paging = json.paging as { cursors?: { after?: string }; next?: string } | undefined;
    after = paging?.next && paging.cursors?.after ? paging.cursors.after : undefined;
  } while (after);
  return forms;
}

export interface RawMetaLead {
  id: string;
  field_data: Array<{ name: string; values: string[] }>;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  platform?: string;
}

/** Fetch all leads for a form (cursor-paginated). */
export async function fetchFormLeads(formId: string, pageToken: string): Promise<RawMetaLead[]> {
  const leads: RawMetaLead[] = [];
  let after: string | undefined;
  do {
    const json = await graphFetch(`${formId}/leads`, {
      access_token: pageToken,
      fields: "field_data,created_time,ad_id,form_id,platform",
      limit: "100",
      after,
    });
    const data = (json.data ?? []) as RawMetaLead[];
    leads.push(...data);
    const paging = json.paging as { cursors?: { after?: string }; next?: string } | undefined;
    after = paging?.next && paging.cursors?.after ? paging.cursors.after : undefined;
  } while (after);
  return leads;
}

// ---- Webhook signature --------------------------------------------------------

/** Verify Meta's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body). */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = appSecret();
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
