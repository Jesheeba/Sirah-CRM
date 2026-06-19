import { redirect } from "next/navigation";
import { getUserContext, type UserContext } from "@/lib/auth";

/**
 * Server guard for the Platform console. Ensures the caller is a platform admin
 * (outside tenant RBAC) before any platform page/RPC runs. Use at the top of every
 * `(platform)` server component / action. Server-only (imports getUserContext).
 */
export async function requirePlatformAdmin(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.isPlatformAdmin) redirect("/dashboard");
  return ctx;
}
