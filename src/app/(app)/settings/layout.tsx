import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth";
import SettingsNav from "@/components/settings/SettingsNav";

// Centralized admin gate for the whole /settings/* subtree. Child pages keep
// their own guards (they still need ctx.tenantId for queries) — this is the
// outer line of defense and the reason every settings page can assume an admin.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.tenantId) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <SettingsNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
