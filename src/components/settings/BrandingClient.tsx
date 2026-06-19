"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ImageUploadField from "@/components/settings/ImageUploadField";
import {
  TOGGLEABLE_MODULES,
  DEFAULT_LABELS,
  isValidHex,
  type ModuleKey,
} from "@/lib/branding";

export interface BrandingFormInitial {
  tenantId: string;
  brand_name: string;
  browser_title: string;
  logo_url: string;
  favicon_url: string;
  login_background_url: string;
  welcome_message: string;
  company_description: string;
  primary_color: string;
  secondary_color: string;
  labels: Record<string, string>;
  visibility: Record<string, boolean>;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";
const labelCls = "text-xs uppercase tracking-wide text-slate-400";

function orNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export default function BrandingClient({ initial }: { initial: BrandingFormInitial }) {
  const supabase = createClient();
  const router = useRouter();

  const [brandName, setBrandName] = useState(initial.brand_name);
  const [browserTitle, setBrowserTitle] = useState(initial.browser_title);
  const [logoUrl, setLogoUrl] = useState(initial.logo_url);
  const [faviconUrl, setFaviconUrl] = useState(initial.favicon_url);
  const [loginBg, setLoginBg] = useState(initial.login_background_url);
  const [welcome, setWelcome] = useState(initial.welcome_message);
  const [companyDesc, setCompanyDesc] = useState(initial.company_description);
  const [primary, setPrimary] = useState(initial.primary_color);
  const [secondary, setSecondary] = useState(initial.secondary_color);
  const [labels, setLabels] = useState<Record<string, string>>(initial.labels);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(
    initial.visibility,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function swatch(hex: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#071689";
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (primary && !isValidHex(primary)) {
      return setError("Primary colour must be a valid hex value, e.g. #2563eb.");
    }
    if (secondary && !isValidHex(secondary)) {
      return setError("Secondary colour must be a valid hex value, e.g. #f59e0b.");
    }

    // Keep only meaningful entries: label overrides that differ from blank, and
    // module_visibility entries that are explicitly disabled.
    const labelOverrides: Record<string, string> = {};
    for (const k of TOGGLEABLE_MODULES) {
      const v = (labels[k] ?? "").trim();
      if (v) labelOverrides[k] = v;
    }
    const visibilityOverrides: Record<string, boolean> = {};
    for (const k of TOGGLEABLE_MODULES) {
      if (visibility[k] === false) visibilityOverrides[k] = false;
    }

    setBusy(true);
    // Gated by the ob_admin_write RLS policy (admins only). Upsert on tenant_id.
    const { error } = await supabase.from("organization_branding").upsert(
      {
        tenant_id: initial.tenantId,
        brand_name: orNull(brandName),
        browser_title: orNull(browserTitle),
        logo_url: orNull(logoUrl),
        favicon_url: orNull(faviconUrl),
        login_background_url: orNull(loginBg),
        welcome_message: orNull(welcome),
        company_description: orNull(companyDesc),
        primary_color: orNull(primary),
        secondary_color: orNull(secondary),
        module_labels: labelOverrides,
        module_visibility: visibilityOverrides,
      },
      { onConflict: "tenant_id" },
    );
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    router.refresh(); // re-render the layout so logo/colours/labels update live
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Saved. Branding updated for everyone in the organization.
        </div>
      )}

      {/* Identity --------------------------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Company identity</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Brand name</label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="e.g. ABC Hospital CRM"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Browser tab title</label>
            <input
              value={browserTitle}
              onChange={(e) => setBrowserTitle(e.target.value)}
              placeholder="Defaults to the brand name"
              className={inputCls}
            />
          </div>
          <ImageUploadField
            tenantId={initial.tenantId}
            kind="logo"
            label="Logo"
            value={logoUrl}
            onChange={setLogoUrl}
            hint="Shown in the sidebar and top bar. PNG or SVG works best."
          />
          <ImageUploadField
            tenantId={initial.tenantId}
            kind="favicon"
            label="Favicon"
            value={faviconUrl}
            onChange={setFaviconUrl}
            hint="Small square image (.ico or .png) for the browser tab."
          />
        </div>
      </section>

      {/* Theme ------------------------------------------------------------ */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Theme colours</h2>
        <p className="text-xs text-slate-500">
          The primary colour drives buttons, links, the active sidebar, and badges
          across the whole workspace. Leave blank to keep the default.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Primary colour</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={swatch(primary)}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                aria-label="Primary colour picker"
              />
              <input
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                placeholder="#071689"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Secondary / accent colour</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={swatch(secondary)}
                onChange={(e) => setSecondary(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                aria-label="Secondary colour picker"
              />
              <input
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                placeholder="#2a3eb8"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Login experience ------------------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Login &amp; welcome</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ImageUploadField
              tenantId={initial.tenantId}
              kind="login-bg"
              label="Login background image"
              value={loginBg}
              onChange={setLoginBg}
              hint="Shown behind the login form at /login?org=<your-slug>."
            />
          </div>
          <div>
            <label className={labelCls}>Welcome message</label>
            <input
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              placeholder="Welcome to ABC Hospital CRM"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Company description</label>
            <input
              value={companyDesc}
              onChange={(e) => setCompanyDesc(e.target.value)}
              placeholder="Delivering Better Patient Care"
              className={inputCls}
            />
          </div>
        </div>
      </section>

      {/* Terminology + visibility ---------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Modules &amp; terminology</h2>
        <p className="text-xs text-slate-500">
          Rename modules to match your industry, and hide any your team doesn&apos;t use.
        </p>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-1 text-xs uppercase tracking-wide text-slate-400">
            <span>Module</span>
            <span>Custom name</span>
            <span>Visible</span>
          </div>
          {TOGGLEABLE_MODULES.map((k: ModuleKey) => (
            <div key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-3">
              <span className="text-sm text-slate-600">{DEFAULT_LABELS[k]}</span>
              <input
                value={labels[k] ?? ""}
                onChange={(e) =>
                  setLabels((prev) => ({ ...prev, [k]: e.target.value }))
                }
                placeholder={DEFAULT_LABELS[k]}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
              <input
                type="checkbox"
                checked={visibility[k] ?? true}
                onChange={(e) =>
                  setVisibility((prev) => ({ ...prev, [k]: e.target.checked }))
                }
                className="h-4 w-4 justify-self-center accent-brand"
                aria-label={`${DEFAULT_LABELS[k]} visible`}
              />
            </div>
          ))}
        </div>
      </section>

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save branding"}
      </button>
    </form>
  );
}
