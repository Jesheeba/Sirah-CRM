import { createClient } from "@/lib/supabase/server";

export type Role = "Admin" | "Manager" | "Sales Rep";

export interface UserContext {
  userId: string;
  email: string;
  role: Role;
  tenantId: string | null;
  tenantName: string;
  tenantStatus: string;
  isAdmin: boolean;
  isManager: boolean;
  isRep: boolean;
  isPlatformAdmin: boolean;
}

/**
 * Resolves the signed-in user, their org, and their highest role.
 * Returns null when there is no authenticated user or no profile yet.
 */
export async function getUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, tenants(name, status)")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;

  const [{ data: roleRows }, { data: paRow }] = await Promise.all([
    supabase.from("user_roles").select("roles(name)").eq("user_id", user.id),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);

  // Untyped client infers the embed loosely; `roles` is a to-one object at runtime.
  const names = ((roleRows ?? []) as Array<{ roles?: { name?: string } | null }>)
    .map((r) => r.roles?.name)
    .filter(Boolean as unknown as (v: string | undefined) => v is string);

  const role: Role = names.includes("Admin")
    ? "Admin"
    : names.includes("Manager")
      ? "Manager"
      : "Sales Rep";

  const tenant = profile.tenants as { name?: string; status?: string } | null;

  return {
    userId: user.id,
    email: user.email ?? "",
    role,
    tenantId: profile.tenant_id ?? null,
    tenantName: tenant?.name ?? "My Organization",
    tenantStatus: tenant?.status ?? "active",
    isAdmin: role === "Admin",
    isManager: role === "Manager",
    isRep: role === "Sales Rep",
    isPlatformAdmin: Boolean(paRow),
  };
}
