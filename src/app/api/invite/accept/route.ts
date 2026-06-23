import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  try {
    const { token, fullName, password } = (await req.json()) as {
      token: string;
      fullName: string;
      password: string;
    };

    if (!token || !fullName?.trim() || !password) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch and validate the invitation
    const { data: inv, error: invErr } = await admin
      .from("invitations")
      .select("id, tenant_id, email, role_id, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (invErr || !inv) {
      return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    }
    if (inv.status !== "pending") {
      return NextResponse.json(
        { error: inv.status === "accepted" ? "This invitation has already been used." : "This invitation has been cancelled." },
        { status: 410 },
      );
    }
    if (new Date(inv.expires_at) < new Date()) {
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    // Create the auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: inv.email,
      password,
      email_confirm: true,
    });

    if (authErr || !authData.user) {
      const msg = authErr?.message ?? "Failed to create account.";
      // If user already exists in auth, surface a friendly message
      if (msg.includes("already")) {
        return NextResponse.json(
          { error: "An account with this email already exists. Try signing in." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const userId = authData.user.id;

    // Create the profile
    const { error: profileErr } = await admin.from("profiles").insert({
      id: userId,
      tenant_id: inv.tenant_id,
      email: inv.email,
      full_name: fullName.trim(),
    });

    if (profileErr) {
      // Roll back: delete the auth user we just created
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    // Assign role
    const { error: roleErr } = await admin.from("user_roles").insert({
      tenant_id: inv.tenant_id,
      user_id: userId,
      role_id: inv.role_id,
    });

    if (roleErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }

    // Mark invitation accepted
    await admin.from("invitations").update({ status: "accepted" }).eq("id", inv.id);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
