import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext, type Role } from "@/lib/auth";
import UsersClient, { type Member } from "@/components/settings/UsersClient";

export default async function SettingsUsersPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, user_roles(roles(name))")
    .order("created_at", { ascending: true });

  // Untyped client infers the embed loosely; treat rows as `any` and read at runtime.
  const members: Member[] = ((data ?? []) as any[]).map((p) => {
    const names = ((p.user_roles ?? []) as any[])
      .map((ur) => ur?.roles?.name)
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Users &amp; Roles</h1>
        <p className="text-sm text-slate-500">Manage who is in your organization and what they can do.</p>
      </div>
      <UsersClient members={members} currentUserId={ctx.userId} />
    </div>
  );
}
