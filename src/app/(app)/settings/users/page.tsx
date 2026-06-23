import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserContext, type Role } from "@/lib/auth";
import UsersClient, { type Member, type PendingInvite } from "@/components/settings/UsersClient";

export default async function SettingsUsersPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only

  const admin = createAdminClient();

  const [{ data: profilesData }, { data: invitesData }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, email, full_name, user_roles(roles(name))")
      .eq("tenant_id", ctx.tenantId!)
      .order("created_at", { ascending: true }),
    admin
      .from("invitations")
      .select("id, email, expires_at, created_at, roles(name)")
      .eq("tenant_id", ctx.tenantId!)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);

  const members: Member[] = ((profilesData ?? []) as any[]).map((p) => {
    const names = ((p.user_roles ?? []) as any[])
      .map((ur: any) => ur?.roles?.name)
      .filter(Boolean) as string[];
    const role: Role = names.includes("Admin")
      ? "Admin"
      : names.includes("Manager")
        ? "Manager"
        : "Sales Rep";
    return {
      id: p.id as string,
      email: (p.email ?? null) as string | null,
      fullName: (p.full_name ?? null) as string | null,
      role,
    };
  });

  const pendingInvites: PendingInvite[] = ((invitesData ?? []) as any[]).map((inv) => ({
    id: inv.id as string,
    email: inv.email as string,
    roleName: (Array.isArray(inv.roles) ? inv.roles[0]?.name : inv.roles?.name) ?? "Sales Rep",
    expiresAt: inv.expires_at as string,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Users &amp; Roles</h1>
        <p className="text-sm text-slate-500">Manage who is in your organization and what they can do.</p>
      </div>
      <UsersClient
        members={members}
        currentUserId={ctx.userId}
        pendingInvites={pendingInvites}
      />
    </div>
  );
}
