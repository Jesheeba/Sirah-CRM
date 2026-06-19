import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { brandRampStyle } from "@/lib/branding";
import LoginForm from "@/components/auth/LoginForm";

interface LoginBranding {
  brand_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  login_background_url: string | null;
  welcome_message: string | null;
  company_description: string | null;
  primary_color: string | null;
}

const RESERVED_SUBDOMAINS = new Set(["www", "app", "localhost"]);

/**
 * Resolve which tenant's branding to show before authentication. We lead with the
 * `?org=<slug>` query param (works with zero DNS setup) and fall back to the host
 * subdomain (acme.example.com → "acme"), which activates automatically once
 * wildcard DNS is configured.
 */
async function resolveSlug(orgParam?: string): Promise<string | null> {
  const fromQuery = orgParam?.trim();
  if (fromQuery) return fromQuery;

  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0];
  const parts = host.split(".");
  if (parts.length > 2 && !RESERVED_SUBDOMAINS.has(parts[0])) return parts[0];
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const slug = await resolveSlug((await searchParams).org);

  let branding: LoginBranding | null = null;
  if (slug) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_login_branding", { p_slug: slug });
    branding = (Array.isArray(data) && data[0] ? (data[0] as LoginBranding) : null);
  }

  const rampStyle = brandRampStyle(branding?.primary_color ?? null);
  const bg = branding?.login_background_url ?? null;

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-4 ${
        bg ? "bg-cover bg-center" : ""
      }`}
      style={bg ? { backgroundImage: `url(${bg})` } : undefined}
    >
      {rampStyle && <style dangerouslySetInnerHTML={{ __html: rampStyle }} />}
      <LoginForm
        brandName={branding?.brand_name ?? null}
        logoUrl={branding?.logo_url ?? null}
        welcomeMessage={branding?.welcome_message ?? null}
        companyDescription={branding?.company_description ?? null}
      />
    </div>
  );
}
