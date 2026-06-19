import type { SupabaseClient } from "@supabase/supabase-js";

// --------------------------------------------------------------- module keys --
// Keys mirror the sidebar/route segments. Used for terminology (labels) and
// module visibility. `dashboard` is intentionally NOT toggleable.
export const MODULE_KEYS = [
  "dashboard",
  "leads",
  "contacts",
  "accounts",
  "deals",
  "products",
  "quotations",
  "email",
  "whatsapp",
  "tasks",
  "calendar",
  "reports",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Modules a tenant admin may hide from the workspace (everything except Dashboard). */
export const TOGGLEABLE_MODULES: ModuleKey[] = MODULE_KEYS.filter(
  (k) => k !== "dashboard",
);

export const DEFAULT_LABELS: Record<ModuleKey, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  contacts: "Contacts",
  accounts: "Accounts",
  deals: "Deals",
  products: "Products",
  quotations: "Quotations",
  email: "Email",
  whatsapp: "WhatsApp",
  tasks: "Tasks",
  calendar: "Calendar",
  reports: "Reports",
};

// ------------------------------------------------------------------- types ----
/** Resolved branding consumed by the app (defaults already applied). */
export interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  loaderLogoUrl: string | null;
  browserTitle: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  loginBackgroundUrl: string | null;
  welcomeMessage: string | null;
  companyDescription: string | null;
  labels: Record<ModuleKey, string>;
  visibility: Record<ModuleKey, boolean>;
}

/** Empty branding with sensible defaults — used when no row exists yet. */
export function defaultBranding(): Branding {
  return {
    brandName: null,
    logoUrl: null,
    faviconUrl: null,
    loaderLogoUrl: null,
    browserTitle: null,
    primaryColor: null,
    secondaryColor: null,
    loginBackgroundUrl: null,
    welcomeMessage: null,
    companyDescription: null,
    labels: { ...DEFAULT_LABELS },
    visibility: Object.fromEntries(
      MODULE_KEYS.map((k) => [k, true]),
    ) as Record<ModuleKey, boolean>,
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Merge tenant label overrides over the defaults (only non-empty strings win). */
export function resolveLabels(
  overrides: Record<string, unknown>,
): Record<ModuleKey, string> {
  const out = { ...DEFAULT_LABELS };
  for (const k of MODULE_KEYS) {
    const v = asString(overrides[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** Resolve module visibility — every module is visible unless explicitly `false`. */
export function resolveVisibility(
  overrides: Record<string, unknown>,
): Record<ModuleKey, boolean> {
  const out = Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<
    ModuleKey,
    boolean
  >;
  for (const k of TOGGLEABLE_MODULES) {
    if (overrides[k] === false) out[k] = false;
  }
  return out;
}

// ----------------------------------------------------------------- fetch ------
const COLS =
  "brand_name, logo_url, favicon_url, loader_logo_url, browser_title, " +
  "primary_color, secondary_color, login_background_url, welcome_message, " +
  "company_description, module_labels, module_visibility";

/**
 * Load and resolve a tenant's branding. Never throws and never returns null —
 * falls back to defaults so every caller can render unconditionally.
 */
export async function fetchBranding(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Branding> {
  const { data } = await supabase
    .from("organization_branding")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) return defaultBranding();

  const row = data as unknown as Record<string, unknown>;
  return {
    brandName: asString(row.brand_name),
    logoUrl: asString(row.logo_url),
    faviconUrl: asString(row.favicon_url),
    loaderLogoUrl: asString(row.loader_logo_url),
    browserTitle: asString(row.browser_title),
    primaryColor: asString(row.primary_color),
    secondaryColor: asString(row.secondary_color),
    loginBackgroundUrl: asString(row.login_background_url),
    welcomeMessage: asString(row.welcome_message),
    companyDescription: asString(row.company_description),
    labels: resolveLabels(asRecord(row.module_labels)),
    visibility: resolveVisibility(asRecord(row.module_visibility)),
  };
}

// --------------------------------------------------------------- colour ------
/** Accepts #rgb or #rrggbb. */
export function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

/** "#071689" -> [7, 22, 137]; expands shorthand. Null on invalid input. */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim();
  if (!isValidHex(h)) return null;
  let body = h.slice(1);
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(body, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix an [r,g,b] toward white by `ratio` (0 = unchanged, 1 = white). */
function mixWhite(rgb: [number, number, number], ratio: number): string {
  const m = rgb.map((c) => Math.round(c + (255 - c) * ratio));
  return `${m[0]} ${m[1]} ${m[2]}`;
}

/**
 * Build the `:root` CSS that overrides the brand colour ramp from a single
 * primary hex. Returns null for an invalid/empty colour (callers then keep the
 * default ramp baked into globals.css). Channel values (space-separated RGB)
 * pair with Tailwind's `rgb(var(--brand-700) / <alpha-value>)` definitions, so
 * every existing `bg-brand`, `text-brand`, `border-brand/30` class re-themes.
 */
export function brandRampStyle(primaryColor: string | null | undefined): string | null {
  if (!primaryColor) return null;
  const rgb = hexToRgb(primaryColor);
  if (!rgb) return null;
  const base = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  return (
    `:root{` +
    `--brand-50:${mixWhite(rgb, 0.93)};` +
    `--brand-100:${mixWhite(rgb, 0.86)};` +
    `--brand-500:${mixWhite(rgb, 0.25)};` +
    `--brand-700:${base};` +
    `}`
  );
}
