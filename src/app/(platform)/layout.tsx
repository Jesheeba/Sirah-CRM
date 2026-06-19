import { requirePlatformAdmin } from "@/lib/platform-guard";
import PlatformNav from "@/components/platform/PlatformNav";
import PlatformTopBar from "@/components/platform/PlatformTopBar";

/**
 * Platform console shell — a layer ABOVE tenant CRM. Gated to platform admins
 * (requirePlatformAdmin redirects everyone else). It deliberately does NOT run the
 * (app) layout, so a platform admin whose own tenant is suspended is unaffected here.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <PlatformNav />
      <div className="flex flex-1 flex-col">
        <PlatformTopBar email={ctx.email} />
        <main className="flex-1 p-4 pb-20 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
