import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Inbound lead webhook (contract v1): an external system (e.g. RD Interlock Bricks' relay)
 * POSTs form submissions to /api/v1/leads/webhook/<channel>. This module holds the pure
 * parts — signature check, field-alias mapping, phone normalisation — so they are testable
 * without a database. The route and the DB writes live in the route handler.
 */

export const WEBHOOK_MAX_BYTES = 1_000_000;
export const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;
export const WEBHOOK_MAX_BATCH = 100;
export const WEBHOOK_RATE_LIMIT_PER_MIN = 120;

/** 64 hex characters (256 bits), as the contract specifies for WEBHOOK_SECRET. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Channel = the fixed path segment. Lower-case letters, digits, `_` and `-`; 2–39 chars. */
export const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9_-]{1,38}$/;

// ---- Signature -------------------------------------------------------------------

/**
 * `sha256=` + hex(HMAC_SHA256(secret, "<timestamp>." + <raw body bytes>)). The timestamp is
 * inside the signed string so a captured request can't be replayed outside the window.
 */
export function signWebhook(secret: string, timestamp: string, rawBody: Buffer | string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.`, "utf8").update(rawBody).digest("hex");
  return `sha256=${mac}`;
}

/** Constant-time check. Anything missing or malformed fails closed. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: Buffer,
): boolean {
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const given = signature.trim().match(/^sha256=([0-9a-fA-F]{64})$/)?.[1];
  if (!given) return false;
  const expected = signWebhook(secret, timestamp, rawBody).slice("sha256=".length);
  return timingSafeEqual(Buffer.from(given.toLowerCase(), "hex"), Buffer.from(expected, "hex"));
}

/** True when the signed timestamp (epoch seconds) is within ±5 minutes of `nowSec`. */
export function timestampFresh(timestamp: string, nowSec: number): boolean {
  return Math.abs(nowSec - Number(timestamp)) <= WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
}

// ---- Phone -------------------------------------------------------------------------

/**
 * Normalise any common Indian-style phone format to E.164: "+91 98765 43210",
 * "09876543210" and "9876543210" all become "+919876543210". Returns null when there are
 * not 7–15 digits (not a usable number).
 */
export function normalizeLeadPhone(raw: string): string | null {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (s.startsWith("+")) return `+${digits}`;
  if (s.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

// ---- Field mapping -----------------------------------------------------------------

/** Names match case-insensitively with separators ignored: fullName = full_name = FULL NAME. */
export function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ALIASES = {
  leadId: ["leadid", "externalid"],
  submittedAt: ["submittedat", "createdtime", "createdat"],
  fullName: ["fullname", "contactname", "customername", "name"],
  phoneNumber: ["phonenumber", "phone", "mobile", "contactnumber"],
  city: ["city", "place", "town", "area", "location", "address"],
  typeOfBricks: ["typeofbricks", "bricktype", "bricksize", "product", "size"],
  typeOfConstruction: ["typeofconstruction", "constructiontype", "purpose", "worktype"],
  numberOfBricks: ["numberofbricks", "brickcount", "quantity", "qty"],
  notes: ["notes", "remarks", "summary", "comments"],
  campaignId: ["campaignid"],
  adsetId: ["adsetid"],
  adId: ["adid"],
  formId: ["formid"],
  platform: ["platform"],
} as const;

type Canonical = keyof typeof ALIASES;

const CANONICAL_BY_KEY = new Map<string, Canonical>();
for (const [canon, names] of Object.entries(ALIASES) as [Canonical, readonly string[]][]) {
  for (const n of names) CANONICAL_BY_KEY.set(n, canon);
}

/** Optional business fields reported back in `missingFields` when absent. */
const REPORTED_OPTIONAL: Array<"fullName" | "city" | "typeOfBricks" | "typeOfConstruction" | "numberOfBricks"> = ["fullName", "city", "typeOfBricks", "typeOfConstruction", "numberOfBricks"];

const PLACEHOLDERS = new Set(["null", "n/a", "na", "none", "unknown", "undefined", "-", "nil"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_EXTRA_FIELDS = 50;
const MAX_VALUE_CHARS = 2000;

/** String form of a scalar; placeholders and empties count as "not sent". */
function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      return null;
    }
  }
  s = s.trim().slice(0, MAX_VALUE_CHARS);
  return !s || PLACEHOLDERS.has(s.toLowerCase()) ? null : s;
}

export interface ParsedWebhookLead {
  externalId: string;
  submittedAt: string | null;
  fullName: string | null;
  phone: string;
  city: string | null;
  typeOfBricks: string | null;
  typeOfConstruction: string | null;
  numberOfBricks: string | null;
  notes: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  formId: string | null;
  platform: string | null;
  /** Fields we don't model, kept verbatim so nothing a form captured is lost. */
  extras: Record<string, string>;
  missingFields: string[];
}

export type ParseResult =
  | { ok: true; lead: ParsedWebhookLead }
  | { ok: false; code: "missing_lead_id" | "missing_phone"; message: string };

export function parseWebhookLead(input: Record<string, unknown>): ParseResult {
  const picked = new Map<Canonical, { value: string; rank: number }>();
  const extras: Record<string, string> = {};
  let extraCount = 0;

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim();
    if (!key || UNSAFE_KEYS.has(key)) continue;
    const value = scalar(rawValue);
    if (value === null) continue;

    const nk = normKey(key);
    const canon = CANONICAL_BY_KEY.get(nk);
    if (canon) {
      // If a sender supplies several aliases of one field, the earlier alias in the list wins.
      const rank = (ALIASES[canon] as readonly string[]).indexOf(nk);
      const prev = picked.get(canon);
      if (!prev || rank < prev.rank) picked.set(canon, { value, rank });
      continue;
    }

    if (extraCount >= MAX_EXTRA_FIELDS) continue;
    // `fb_*` is reserved for our own routing metadata; never let a sender spoof it.
    const safeKey = (key.startsWith("fb_") ? `x_${key}` : key).replace(/[\u0000-\u001f]/g, "").slice(0, 60);
    if (!safeKey || safeKey in extras) continue;
    extras[safeKey] = value;
    extraCount++;
  }

  const get = (c: Canonical): string | null => picked.get(c)?.value ?? null;

  const externalId = get("leadId");
  if (!externalId) return { ok: false, code: "missing_lead_id", message: "leadId is required." };

  const rawPhone = get("phoneNumber");
  const phone = rawPhone ? normalizeLeadPhone(rawPhone) : null;
  if (!phone) return { ok: false, code: "missing_phone", message: "A valid phoneNumber is required." };

  const submitted = get("submittedAt");
  const at = submitted ? Date.parse(submitted) : NaN;
  const bricks = get("numberOfBricks");

  const lead: ParsedWebhookLead = {
    externalId,
    submittedAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
    fullName: get("fullName"),
    phone,
    city: get("city"),
    typeOfBricks: get("typeOfBricks"),
    typeOfConstruction: get("typeOfConstruction"),
    numberOfBricks: bricks ? bricks.replace(/,/g, "") : null,
    notes: get("notes"),
    campaignId: get("campaignId"),
    adsetId: get("adsetId"),
    adId: get("adId"),
    formId: get("formId"),
    platform: get("platform"),
    extras,
    missingFields: [],
  };
  lead.missingFields = REPORTED_OPTIONAL.filter((f) => lead[f] === null);
  return { ok: true, lead };
}

// ---- CRM record ----------------------------------------------------------------------

export interface LeadRecord {
  first_name: string | null;
  last_name: string | null;
  phone: string;
  source: string;
  custom_fields: Record<string, string>;
}

/**
 * Map a parsed submission onto a CRM lead. Routing metadata uses the same `fb_*` keys as
 * Meta-sourced leads, so webhook leads appear in the pull feed and a submission that also
 * arrives through the direct Meta connection is recognised as the same lead.
 */
export function toLeadRecord(l: ParsedWebhookLead): LeadRecord {
  let first: string | null = null;
  let last: string | null = null;
  if (l.fullName) {
    const parts = l.fullName.split(/\s+/);
    first = parts[0] ?? null;
    last = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  const ig = /^(ig|instagram)$/i.test(l.platform ?? "");
  const custom: Record<string, string> = { ...l.extras };
  const put = (k: string, v: string | null) => {
    if (v !== null) custom[k] = v;
  };
  put("city", l.city);
  put("type_of_bricks", l.typeOfBricks);
  put("type_of_construction", l.typeOfConstruction);
  put("number_of_bricks", l.numberOfBricks);
  put("notes", l.notes);

  custom.fb_leadgen_id = l.externalId;
  put("fb_created_time", l.submittedAt);
  put("fb_campaign_id", l.campaignId);
  put("fb_adset_id", l.adsetId);
  put("fb_ad_id", l.adId);
  put("fb_form_id", l.formId);
  if (l.platform) custom.fb_platform = ig ? "ig" : "fb";

  return {
    first_name: first,
    last_name: last,
    phone: l.phone,
    source: ig ? "Instagram Lead Ads" : "Facebook Lead Ads",
    custom_fields: custom,
  };
}
