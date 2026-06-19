import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLeadDetail, mapLead, metaVerifyToken, verifyMetaSignature } from "@/lib/meta";

/** Webhook verification handshake (Meta calls GET once on subscribe). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");
  if (mode === "subscribe" && token && token === metaVerifyToken()) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface LeadgenChange {
  field?: string;
  value?: { leadgen_id?: string; form_id?: string; page_id?: string };
}
interface Entry {
  id?: string; // the Page id
  changes?: LeadgenChange[];
}

/**
 * Receives `leadgen` events. Verifies the signature, then for each lead: claims the
 * leadgen_id (idempotency), resolves tenant + Page token, fetches the answers from the
 * Graph API, and inserts a lead (service role, explicit tenant_id). Always returns 200.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ received: true }); // ignore unverified payloads
  }

  try {
    const body = JSON.parse(raw) as { entry?: Entry[] };
    const admin = createAdminClient();

    for (const entry of body.entry ?? []) {
      const pageId = entry.id ?? null;
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
        const leadgenId = change.value.leadgen_id;
        const formId = change.value.form_id ?? null;

        // 1. Claim the leadgen_id. A duplicate (Meta retry) hits the unique constraint → skip.
        const { error: claimErr } = await admin
          .from("meta_lead_events")
          .insert({ leadgen_id: leadgenId, page_id: pageId, form_id: formId, status: "received" });
        if (claimErr) continue;

        // 2. Resolve tenant + Page token by page_id.
        const { data: page } = await admin
          .from("meta_lead_pages")
          .select("tenant_id, access_token, default_owner_id, is_enabled")
          .eq("page_id", pageId ?? "")
          .maybeSingle();

        if (!page || !page.is_enabled) {
          await admin
            .from("meta_lead_events")
            .update({ status: "skipped", error: "no enabled page for this page_id" })
            .eq("leadgen_id", leadgenId);
          continue;
        }

        // 3. Fetch answers, map, and insert the lead.
        try {
          const detail = await fetchLeadDetail(leadgenId, page.access_token as string);
          const mapped = mapLead(detail);
          const custom_fields: Record<string, string> = {
            ...mapped.answers,
            fb_leadgen_id: leadgenId,
          };
          const resolvedForm = detail.form_id ?? formId;
          if (resolvedForm) custom_fields.fb_form_id = resolvedForm;
          if (detail.ad_id) custom_fields.fb_ad_id = detail.ad_id;
          if (pageId) custom_fields.fb_page_id = pageId;
          if (detail.platform) custom_fields.fb_platform = detail.platform;

          const { data: lead, error: leadErr } = await admin
            .from("leads")
            .insert({
              tenant_id: page.tenant_id,
              first_name: mapped.first_name,
              last_name: mapped.last_name,
              email: mapped.email,
              phone: mapped.phone,
              company: mapped.company,
              source: mapped.source,
              status: "new",
              score: 0,
              owner_id: page.default_owner_id ?? null,
              custom_fields,
            })
            .select("id")
            .single();
          if (leadErr) throw new Error(leadErr.message);

          await admin
            .from("meta_lead_events")
            .update({ status: "created", tenant_id: page.tenant_id, lead_id: lead.id })
            .eq("leadgen_id", leadgenId);
        } catch (e) {
          await admin
            .from("meta_lead_events")
            .update({
              status: "error",
              tenant_id: page.tenant_id,
              error: (e as Error).message?.slice(0, 500) ?? "unknown error",
            })
            .eq("leadgen_id", leadgenId);
        }
      }
    }
  } catch {
    // swallow — always return 200 so Meta doesn't retry indefinitely
  }
  return NextResponse.json({ received: true });
}
