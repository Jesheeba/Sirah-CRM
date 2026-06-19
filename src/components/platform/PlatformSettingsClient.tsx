"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FeatureFlag, PlatformConfig } from "@/lib/platform";

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

export default function PlatformSettingsClient({
  config,
  flags,
}: {
  config: PlatformConfig;
  flags: FeatureFlag[];
}) {
  const supabase = createClient();
  const [cfg, setCfg] = useState<PlatformConfig>({
    default_currency: config.default_currency ?? "INR",
    default_timezone: config.default_timezone ?? "Asia/Kolkata",
    default_locale: config.default_locale ?? "en",
    support_email: config.support_email ?? "",
    signups_enabled: config.signups_enabled ?? true,
    maintenance_mode: config.maintenance_mode ?? false,
  });
  const [rows, setRows] = useState<FeatureFlag[]>(flags);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveConfig() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("admin_platform_settings_set", { p_value: cfg });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function toggleFlag(f: FeatureFlag) {
    const next = !f.enabled;
    setRows((rs) => rs.map((x) => (x.key === f.key ? { ...x, enabled: next } : x)));
    const { error } = await supabase.rpc("admin_upsert_feature_flag", {
      p_key: f.key,
      p_label: f.label,
      p_description: f.description,
      p_enabled: next,
    });
    if (error) {
      setError(error.message);
      setRows((rs) => rs.map((x) => (x.key === f.key ? { ...x, enabled: !next } : x)));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Platform settings</h1>
        <p className="text-sm text-slate-500">Global defaults and feature flags for the whole platform.</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Global defaults */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Global defaults</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Default currency</label>
            <input value={cfg.default_currency} onChange={(e) => setCfg({ ...cfg, default_currency: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Default timezone</label>
            <input value={cfg.default_timezone} onChange={(e) => setCfg({ ...cfg, default_timezone: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Default locale</label>
            <input value={cfg.default_locale} onChange={(e) => setCfg({ ...cfg, default_locale: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Support email</label>
            <input type="email" value={cfg.support_email} onChange={(e) => setCfg({ ...cfg, support_email: e.target.value })} className={INPUT} />
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <label className="flex items-center justify-between">
            <span>
              <span className="block text-sm text-slate-700">Signups enabled</span>
              <span className="block text-xs text-slate-400">Allow new organizations to self-register.</span>
            </span>
            <Toggle on={!!cfg.signups_enabled} onChange={() => setCfg({ ...cfg, signups_enabled: !cfg.signups_enabled })} />
          </label>
          <label className="flex items-center justify-between">
            <span>
              <span className="block text-sm text-slate-700">Maintenance mode</span>
              <span className="block text-xs text-slate-400">Flag for upcoming read-only/maintenance windows.</span>
            </span>
            <Toggle on={!!cfg.maintenance_mode} onChange={() => setCfg({ ...cfg, maintenance_mode: !cfg.maintenance_mode })} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={saveConfig} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Saving…" : "Save settings"}
          </button>
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
        </div>
      </div>

      {/* Feature flags */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Feature flags</h2>
        <p className="mb-3 text-xs text-slate-400">Future-ready toggles for upcoming modules.</p>
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-slate-400">No flags defined.</p>}
          {rows.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 border-b border-slate-50 py-2 last:border-0">
              <span>
                <span className="block text-sm text-slate-700">{f.label}</span>
                <span className="block text-xs text-slate-400">{f.description ?? f.key}</span>
              </span>
              <Toggle on={f.enabled} onChange={() => toggleFlag(f)} />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
