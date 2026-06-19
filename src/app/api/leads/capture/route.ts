import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Standard CRM fields — everything else goes into custom_fields.
const STANDARD_FIELDS = new Set(["first_name", "last_name", "email", "phone", "company", "source", "token"]);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token." }, { headers: CORS_HEADERS });
  }

  // Parse body — accept JSON or form-encoded (works with plain HTML forms)
  const body: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const json = (await req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === "string") body[k] = v;
      }
    } else {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) {
        if (typeof v === "string") body[k] = v;
      }
    }
  } catch {
    // empty body is fine — lead with no fields still inserts
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("lead_capture_token", token)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json({ ok: false, error: "Invalid token." }, { headers: CORS_HEADERS });
  }

  const custom_fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!STANDARD_FIELDS.has(k) && v.trim()) custom_fields[k] = v.trim();
  }

  const { error } = await admin.from("leads").insert({
    tenant_id: tenant.id,
    first_name: body.first_name?.trim() || null,
    last_name: body.last_name?.trim() || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    company: body.company?.trim() || null,
    source: body.source?.trim() || "Landing Page",
    status: "new",
    custom_fields: Object.keys(custom_fields).length ? custom_fields : null,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: "Could not save lead." }, { headers: CORS_HEADERS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
