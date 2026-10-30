import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildCsv,
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
 * authorised solely by the per-tenant `?token=` created by the Super Admin.
 *
 *   ?token=…            required
 *   ?format=json|csv    default json
 *   ?since=<timestamp>  only leads created strictly after this (use `next_since` to page)
 *   ?limit=1..1000      default 500
 *
 * Leads come back oldest-first so a consumer can keep `next_since` as its cursor.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = p.get("token");
  if (!token) return fail("Missing token.", 401);

  const format = (p.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") return fail("format must be json or csv.", 400);

  const since = parseSince(p.get("since"));
  if (since === undefined) return fail("since must be a valid timestamp.", 400);
  const limit = parseLimit(p.get("limit"));

  const admin = createAdminClient();

  const { data: feed } = await admin
    .from("tenant_lead_feeds")
    .select("tenant_id")
    .eq("token", token)
    .maybeSingle();
  if (!feed) return fail("Invalid token.", 401);
  const tenantId = feed.tenant_id as string;

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
