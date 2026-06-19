import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { TOGGLEABLE_MODULES } from "@/lib/branding";
import BrandingClient, {
  type BrandingFormInitial,
} from "@/components/settings/BrandingClient";

const COLS =
  "brand_name, browser_title, logo_url, favicon_url, login_background_url, " +
  "welcome_message, company_description, primary_color, secondary_color, " +
  "module_labels, module_visibility";

export default async function BrandingPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/onboarding");
  if (!ctx.isAdmin) redirect("/dashboard"); // admin-only
  if (!ctx.tenantId) redirect("/onboarding");

  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_branding")
    .select(COLS)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, unknown>;
  const labelOverrides = (row.module_labels ?? {}) as Record<string, unknown>;
  const visibilityOverrides = (row.module_visibility ?? {}) as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v : "");

  const initial: BrandingFormInitial = {
    tenantId: ctx.tenantId,
    brand_name: str(row.brand_name),
    browser_title: str(row.browser_title),
    logo_url: str(row.logo_url),
    favicon_url: str(row.favicon_url),
    login_background_url: str(row.login_background_url),
    welcome_message: str(row.welcome_message),
    company_description: str(row.company_description),
    primary_color: str(row.primary_color),
    secondary_color: str(row.secondary_color),
    labels: Object.fromEntries(
      TOGGLEABLE_MODULES.map((k) => [k, str(labelOverrides[k])]),
    ),
    visibility: Object.fromEntries(
      TOGGLEABLE_MODULES.map((k) => [k, visibilityOverrides[k] !== false]),
    ),
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings · Branding</h1>
        <p className="text-sm text-slate-500">
          White-label the workspace: logo, colours, terminology, and which modules
          your team sees. Changes apply to everyone in the organization.
        </p>
      </div>
      <BrandingClient initial={initial} />
    </div>
  );
}
