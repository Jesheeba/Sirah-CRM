import { createClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE Supabase client — BYPASSES ROW LEVEL SECURITY and column privileges.
 *
 * Use ONLY in server code that must read/write provider secrets in `integration_settings`
 * (the secret columns are unreadable by the anon/authenticated roles by design).
 *
 * ⚠️  Because RLS is bypassed, every query MUST manually scope by tenant, e.g.
 *     `.eq("tenant_id", ctx.tenantId)`. A forgotten filter is a cross-tenant data leak.
 * ⚠️  Server-only. Never import this into a client component. Two protections enforce that:
 *       1. Next.js does not expose non-NEXT_PUBLIC_ env vars to the client bundle, so the
 *          service key is `undefined` in the browser and the throw below fires.
 *       2. The explicit `window` guard below throws if this ever runs client-side.
 */
if (typeof window !== "undefined") {
  throw new Error("supabase/admin.ts is server-only and must not be imported in the browser.");
}

export function createAdminClient() {
  // Validate lazily (at call time, not import time) so the build doesn't fail when the
  // key is unset — only code paths that actually need the service role require it.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required for per-tenant integration secrets " +
        "(server-only — never expose it as NEXT_PUBLIC_).",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
