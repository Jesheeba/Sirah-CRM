import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchBranding, brandRampStyle, defaultBranding } from "@/lib/branding";
import { RoleProvider } from "@/components/RoleProvider";
import { BrandingProvider } from "@/components/branding/BrandingProvider";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import MobileNav from "@/components/MobileNav";

// Per-tenant browser tab title + favicon. Runs per request; falls back to the
// org name and the default icon when no branding row exists.
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return {};
  const supabase = await createClient();
  const b = await fetchBranding(supabase, ctx.tenantId);
  const title = b.browserTitle || b.brandName || ctx.tenantName || "CRM";
  return {
    title,
    ...(b.faviconUrl ? { icons: { icon: b.faviconUrl, apple: b.faviconUrl } } : {}),
  };
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getUserContext();
  // Middleware guarantees auth on (app) routes; a missing profile means onboarding.
  if (!ctx) redirect("/onboarding");
  // Suspended workspaces are blocked for everyone except platform admins (who need /platform).
  if (ctx.tenantStatus === "suspended" && !ctx.isPlatformAdmin) redirect("/suspended");

  const branding = ctx.tenantId
    ? await fetchBranding(await createClient(), ctx.tenantId)
    : defaultBranding();
  const rampStyle = brandRampStyle(branding.primaryColor);
  const orgName = branding.brandName ?? ctx.tenantName;

  return (
    <RoleProvider role={ctx.role}>
      <BrandingProvider
        value={{
          brandName: branding.brandName,
          logoUrl: branding.logoUrl,
          labels: branding.labels,
          visibility: branding.visibility,
        }}
      >
        {rampStyle && <style dangerouslySetInnerHTML={{ __html: rampStyle }} />}
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col">
            <TopBar
              email={ctx.email}
              orgName={orgName}
              logoUrl={branding.logoUrl}
              role={ctx.role}
              isAdmin={ctx.isAdmin}
              isPlatformAdmin={ctx.isPlatformAdmin}
            />
            <main className="flex-1 p-4 pb-20 sm:p-6 md:pb-6">{children}</main>
          </div>
          <MobileNav />
        </div>
      </BrandingProvider>
    </RoleProvider>
  );
}
