import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Standard seller fields — everything else goes into custom_fields.
const STANDARD_FIELDS = new Set(["name", "email", "phone", "business_name", "seller_id"]);

/**
 * Server-to-server POST endpoint. sirahagents.com calls this when a seller registers.
 * Auth: ?token={lead_capture_token} from tenants table.
 *
 * Always returns HTTP 200 so sirahagents.com doesn't retry-storm on transient errors.
 * Invalid tokens and failures are logged to sirahagents_events for debugging.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const token = new URL(req.url).searchParams.get("token");

  // Parse JSON body
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty or malformed body — proceed with empty
  }

  // Log everything to sirahagents_events; start with a 'received' row
  const eventBase = {
    email: typeof body.email === "string" ? body.email.trim() || null : null,
    seller_id: typeof body.seller_id === "string" ? body.seller_id.trim() || null : null,
    payload: body,
  };

  if (!token) {
    await admin.from("sirahagents_events").insert({ ...eventBase, status: "invalid_token", error: "Missing token" });
    return NextResponse.json({ ok: false, error: "invalid_token" });
  }

  // Resolve tenant from lead_capture_token
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("lead_capture_token", token)
    .maybeSingle();

  if (!tenant) {
    await admin.from("sirahagents_events").insert({ ...eventBase, status: "invalid_token", error: "Token not found" });
    return NextResponse.json({ ok: false, error: "invalid_token" });
  }

  const tenantId = tenant.id;

  // Insert an event row to track this attempt
  const { data: eventRow } = await admin
    .from("sirahagents_events")
    .insert({ ...eventBase, tenant_id: tenantId, status: "received" })
    .select("id")
    .single();
  const eventId = eventRow?.id ?? null;

  const updateEvent = async (patch: Record<string, unknown>) => {
    if (eventId) await admin.from("sirahagents_events").update(patch).eq("id", eventId);
  };

  try {
    const email = typeof body.email === "string" ? body.email.trim() || null : null;
    const phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
    const businessName = typeof body.business_name === "string" ? body.business_name.trim() || null : null;

    // Split name into first_name / last_name on first space
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const spaceIdx = rawName.indexOf(" ");
    const firstName = spaceIdx >= 0 ? rawName.slice(0, spaceIdx).trim() || null : rawName || null;
    const lastName = spaceIdx >= 0 ? rawName.slice(spaceIdx + 1).trim() || null : null;

    // Dedup: if a lead with same email already exists for this tenant and is still active, skip insert
    if (email) {
      const { count } = await admin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("email", email)
        .in("status", ["new", "contacted", "qualified"])
        .is("deleted_at", null);

      if ((count ?? 0) > 0) {
        await updateEvent({ status: "deduped" });
        return NextResponse.json({ ok: true, deduped: true });
      }
    }

    // Build custom_fields from non-standard keys
    const custom_fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!STANDARD_FIELDS.has(k) && typeof v === "string" && v.trim()) {
        custom_fields[k] = v.trim();
      }
    }

    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .insert({
        tenant_id: tenantId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        company: businessName,
        source: "Sirah Agents",
        status: "new",
        custom_fields: Object.keys(custom_fields).length ? custom_fields : null,
      })
      .select("id")
      .single();

    if (leadErr || !lead) {
      await updateEvent({ status: "error", error: leadErr?.message ?? "Insert failed" });
      return NextResponse.json({ ok: false, error: "lead_insert_failed" });
    }

    await updateEvent({ status: "created", lead_id: lead.id });
    return NextResponse.json({ ok: true, lead_id: lead.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await updateEvent({ status: "error", error: msg.slice(0, 500) });
    return NextResponse.json({ ok: false, error: "server_error" });
  }
}
