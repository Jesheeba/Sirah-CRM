"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  currency: string;
  timezone: string;
  locale: string;
}

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "AUD", "CAD", "SGD"];

/** Light normalisation while typing — keeps the field URL-safe without fighting the cursor. */
function typingSlug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

/** Strict form persisted on save: collapse/strip hyphens. */
function finalizeSlug(v: string): string {
  return typingSlug(v).replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export default function OrganizationClient({ initial }: { initial: OrgProfile }) {
  const supabase = createClient();
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [currency, setCurrency] = useState(initial.currency);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [locale, setLocale] = useState(initial.locale);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!name.trim()) return setError("Organization name is required.");

    const cleanSlug = finalizeSlug(slug);
    if (cleanSlug.length < 3) {
      return setError("Workspace URL must be at least 3 characters (letters, numbers, hyphens).");
    }

    setBusy(true);
    // Gated by the tenant_admin_write RLS policy (admins only).
    const { error } = await supabase
      .from("tenants")
      .update({
        name: name.trim(),
        slug: cleanSlug,
        currency: currency.trim(),
        timezone: timezone.trim(),
        locale: locale.trim(),
      })
      .eq("id", initial.id);
    setBusy(false);
    if (error) {
      // 23505 = unique violation: another workspace already owns this slug.
      if (error.code === "23505") {
        return setError("That workspace URL is already taken — try another.");
      }
      return setError(error.message);
    }
    setSlug(cleanSlug);
    setSaved(true);
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Saved.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">Organization name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Timezone</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Asia/Kolkata"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Locale</label>
          <input
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            placeholder="en"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Plan</label>
          <input
            value={initial.plan_tier}
            disabled
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm capitalize text-slate-500"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Workspace URL
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(typingSlug(e.target.value))}
            placeholder="e.g. sirah"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
          />
          <p className="mt-1 text-xs text-slate-400">
            Lowercase letters, numbers, and hyphens. Used for your branded login:{" "}
            <span className="font-mono text-slate-500">/login?org={slug || "your-url"}</span>
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
