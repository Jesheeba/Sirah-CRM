// Pure, client+server-safe: types + formatting only. The server-only platform
// guard lives in `lib/platform-guard.ts` so client components can import `timeAgo`
// and these types without pulling server code (next/headers) into the browser bundle.

// ── RPC result types ─────────────────────────────────────────────────────────
export interface PlatformOverview {
  tenants_total: number;
  tenants_active: number;
  tenants_suspended: number;
  users_total: number;
  leads_total: number;
  contacts_total: number;
  deals_total: number;
  signups_7d: number;
  signups_30d: number;
  recent_tenants: { id: string; name: string; slug: string; status: string; created_at: string }[];
}

export interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  plan_tier: string;
  created_at: string;
  users: number;
  leads: number;
  contacts: number;
  deals: number;
  last_activity: string | null;
}

export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  plan_tier: string;
  currency: string;
  timezone: string;
  locale: string;
  created_at: string;
  users: number;
  leads: number;
  contacts: number;
  deals: number;
  tasks: number;
  quotations: number;
  last_activity: string | null;
  integrations: { channel: string; enabled: boolean }[];
  admins: string[];
}

export interface PlatformActivity {
  id: number;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface PlatformMonitoring {
  db_ok: boolean;
  integrations: { email_enabled: number; whatsapp_enabled: number };
  jobs: { queued: number; running: number; failed: number };
  recent_jobs: {
    id: string;
    kind: string;
    status: string;
    error: string | null;
    created_at: string;
    finished_at: string | null;
  }[];
  tenant_health: {
    id: string;
    name: string;
    status: string;
    last_activity: string | null;
    users: number;
  }[];
}

export interface PlatformConfig {
  default_currency?: string;
  default_timezone?: string;
  default_locale?: string;
  signups_enabled?: boolean;
  maintenance_mode?: boolean;
  support_email?: string;
}

export interface FeatureFlag {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** "2h ago" style relative time for activity/health tables. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
