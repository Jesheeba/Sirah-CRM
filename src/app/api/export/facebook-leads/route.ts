import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FEED_RATE_LIMIT_PER_MIN,
  buildCsv,
  extractFeedKey,
  hashFeedKey,
  parseLimit,
  parseSince,
  toCursor,
  toFeedLead,
  type FeedLeadRow,
} from "@/lib/lead-feed";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * Pull feed of a tenant's Meta Lead Ads leads (Facebook + Instagram), for external CRMs,
 * Excel Power Query and Google Sheets. No session: it is allow-listed in middleware and
 * authorised solely by an API key the Super Admin created for the tenant. Send it as
 * `Authorization: Bearer <key>` (or `X-API-Key`); `?token=<key>` is accepted for tools
 * that cannot set headers (Excel, Google Sheets) but leaves the key in URLs and logs.
 * Keys are stored hashed and rate-limited per key.
 *
 *   Authorization: Bearer <key>   required (or ?token=)
 *   ?format=json|csv    default json
 *   ?since=<timestamp>  only leads created strictly after this (use `next_since` to page)
 *   ?limit=1..1000      default 500
 *
 * Leads come back oldest-first so a consumer can keep `next_since` as its cursor.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const supplied = extractFeedKey(req.headers, p);
  if (!supplied) return fail("Missing API key.", 401);

  const format = (p.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") return fail("format must be json or csv.", 400);

  const since = parseSince(p.get("since"));
  if (since === undefined) return fail("since must be a valid timestamp.", 400);
  const limit = parseLimit(p.get("limit"));

  const admin = createAdminClient();

  // Keys are stored only as SHA-256 hashes, so look the caller's key up by its hash.
  const { data: keyRow } = await admin
    .from("lead_feed_keys")
    .select("id, tenant_id")
    .eq("key_hash", hashFeedKey(supplied.key))
    .is("revoked_at", null)
    .maybeSingle();
  if (!keyRow) return fail("Invalid API key.", 401);
  const tenantId = keyRow.tenant_id as string;

  // Per-key rate limit (also stamps last-used). Fail closed if the limiter itself errors.
  const { data: allowed, error: rateErr } = await admin.rpc("lead_feed_hit", {
    p_key: keyRow.id,
    p_limit: FEED_RATE_LIMIT_PER_MIN,
    p_via: supplied.via,
  });
  if (rateErr) return fail("Could not process the request.", 500);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute.", retry_after_seconds: 60 },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name, status, deleted_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant || tenant.deleted_at || tenant.status !== "active") {
    return fail("This account is not active.", 403);
  }

  let q = admin
    .from("leads")
    .select("id, first_name, last_name, email, phone, company, source, created_at, custom_fields")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("custom_fields->>fb_leadgen_id", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (since) q = q.gt("created_at", since);

  const { data: rows, error } = await q;
  if (error) return fail("Could not load leads.", 500);

  const leadRows = (rows ?? []) as unknown as FeedLeadRow[];

  const { data: pages } = await admin
    .from("meta_lead_pages")
    .select("page_id, page_name")
    .eq("tenant_id", tenantId);
  const pageNames = new Map<string, string>(
    (pages ?? [])
      .filter((pg) => pg.page_id && pg.page_name)
      .map((pg) => [pg.page_id as string, pg.page_name as string]),
  );

  const leads = leadRows.map((r) => toFeedLead(r, pageNames));

  if (format === "csv") {
    return new NextResponse(buildCsv(leads), {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  const last = leadRows[leadRows.length - 1];
  return NextResponse.json(
    {
      tenant: tenant.name,
      count: leads.length,
      // Pass this back as ?since= to fetch only newer leads. Equals the request's own
      // cursor when nothing new has arrived.
      next_since: last ? toCursor(last.created_at) : (since ?? null),
      leads,
    },
    { headers: NO_STORE },
  );
}
