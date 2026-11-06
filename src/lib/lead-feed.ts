import { createHash, randomBytes } from "crypto";

/** One lead as exposed by the pull feed. Stable, documented shape for external consumers. */
export interface FeedLead {
  id: string;
  leadgen_id: string | null;
  /** When the lead reached the CRM. This is the paging cursor for `since`/`next_since`. */
  created_at: string;
  /** When the person actually submitted the form on Meta; null if Meta didn't report it. */
  submitted_at: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  platform: string | null;
  page_id: string | null;
  page_name: string | null;
  form_id: string | null;
  form_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  answers: Record<string, string>;
}

export interface FeedLeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  created_at: string;
  custom_fields: Record<string, unknown> | null;
}

export const FEED_DEFAULT_LIMIT = 500;
export const FEED_MAX_LIMIT = 1000;

/** Requests allowed per key per minute before the feed answers 429. */
export const FEED_RATE_LIMIT_PER_MIN = 60;
/** Active (non-revoked) keys a single tenant may hold. */
export const FEED_MAX_ACTIVE_KEYS = 10;

/** Opaque, URL-safe, high-entropy feed key. */
export function generateFeedToken(): string {
  return `lf_${randomBytes(32).toString("base64url")}`;
}

/** Only this hash is stored; the key itself can't be recovered from it. */
export function hashFeedKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Short, non-secret label so a key can be recognised in the UI (e.g. "lf_Ab12Cd"). */
export function feedKeyPrefix(key: string): string {
  return key.slice(0, 8);
}

/**
 * Where the caller put the key. A header is preferred — URLs end up in browser history,
 * proxy and server logs, and screenshots. `?token=` remains for Excel / Google Sheets,
 * which cannot send headers. The header wins if both are present.
 */
export function extractFeedKey(
  headers: { get(name: string): string | null },
  query: { get(name: string): string | null },
): { key: string; via: "header" | "url" } | null {
  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) return { key: bearer, via: "header" };
  const apiKey = headers.get("x-api-key")?.trim();
  if (apiKey) return { key: apiKey, via: "header" };
  const token = query.get("token")?.trim();
  if (token) return { key: token, via: "url" };
  return null;
}

/** Clamp `?limit=` to [1, FEED_MAX_LIMIT]; fall back to the default on junk input. */
export function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return FEED_DEFAULT_LIMIT;
  return Math.min(n, FEED_MAX_LIMIT);
}

/**
 * Validate `?since=` as a timestamp. Returns null when absent, `undefined` when invalid.
 * The original string is returned untouched on purpose: Postgres stores microseconds, and
 * round-tripping through a JS Date (milliseconds) would make the cursor re-return the
 * last lead of the previous page.
 */
export function parseSince(raw: string | null): string | null | undefined {
  const s = raw?.trim();
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? undefined : s;
}

/** Cursor value for the next request: `Z` form so it survives a URL query string intact. */
export function toCursor(createdAt: string): string {
  return createdAt.replace(/\+00:00$/, "Z");
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Meta reports times as `2026-08-14T09:30:00+0000`; hand consumers standard ISO-8601 (UTC). */
function toIso(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function toFeedLead(row: FeedLeadRow, pageNames: Map<string, string>): FeedLead {
  const cf = row.custom_fields ?? {};
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cf)) {
    if (k.startsWith("fb_")) continue; // routing metadata is surfaced as top-level fields
    if (typeof v === "string" && v) answers[k] = v;
  }
  const pageId = str(cf.fb_page_id);
  return {
    id: row.id,
    leadgen_id: str(cf.fb_leadgen_id),
    created_at: row.created_at,
    submitted_at: toIso(str(cf.fb_created_time)),
    first_name: row.first_name,
    last_name: row.last_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    email: row.email,
    phone: row.phone,
    company: row.company,
    source: row.source,
    platform: str(cf.fb_platform),
    page_id: pageId,
    page_name: pageId ? (pageNames.get(pageId) ?? null) : null,
    form_id: str(cf.fb_form_id),
    form_name: str(cf.fb_form_name),
    ad_id: str(cf.fb_ad_id),
    ad_name: str(cf.fb_ad_name),
    answers,
  };
}

const BASE_COLUMNS = [
  "id",
  "leadgen_id",
  "created_at",
  "submitted_at",
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "company",
  "source",
  "platform",
  "page_id",
  "page_name",
  "form_id",
  "form_name",
  "ad_id",
  "ad_name",
] as const;

/**
 * Neutralise spreadsheet formula injection: a cell starting with = + - @ (or a tab/CR)
 * is executed as a formula by Excel/Sheets, and lead answers are attacker-controlled.
 */
function csvCell(value: string | null | undefined): string {
  let s = value ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with fixed base columns followed by one column per distinct form-answer key. */
export function buildCsv(leads: FeedLead[]): string {
  const answerKeys = [...new Set(leads.flatMap((l) => Object.keys(l.answers)))].sort();
  // Prefixed so a form question named e.g. "phone" can't duplicate a base column header.
  const header = [...BASE_COLUMNS, ...answerKeys.map((k) => `answer_${k}`)];
  const lines = [header.map(csvCell).join(",")];
  for (const l of leads) {
    const cells = [
      ...BASE_COLUMNS.map((c) => l[c]),
      ...answerKeys.map((k) => l.answers[k] ?? ""),
    ];
    lines.push(cells.map((c) => csvCell(c)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
