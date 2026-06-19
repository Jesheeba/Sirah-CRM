"use client";

import { useState } from "react";
import {
  clearIntegrationSecret,
  saveIntegration,
  type SaveIntegrationInput,
} from "@/app/(app)/settings/integrations/actions";
import { type IntegrationChannel, type IntegrationSetting } from "@/lib/types";

type FieldKey =
  | "from_email"
  | "from_name"
  | "phone_id"
  | "business_account_id"
  | "sms_sender_id";

interface FieldDef {
  key: FieldKey;
  label: string;
  placeholder: string;
}

interface ChannelDef {
  channel: IntegrationChannel;
  title: string;
  provider: string;
  fields: FieldDef[];
  secretLabel: string;
  help?: string;
}

const EMAIL: ChannelDef = {
  channel: "email",
  title: "Email",
  provider: "Resend",
  fields: [
    { key: "from_email", label: "From email", placeholder: "sales@yourdomain.com" },
    { key: "from_name", label: "From name", placeholder: "Acme Sales" },
  ],
  secretLabel: "Resend API key",
  help: "The From address must be on a domain verified in your Resend account, or sends will be rejected.",
};

const WHATSAPP: ChannelDef = {
  channel: "whatsapp",
  title: "WhatsApp",
  provider: "Meta Cloud API",
  fields: [
    { key: "phone_id", label: "Phone number ID", placeholder: "1234567890" },
    { key: "business_account_id", label: "Business account ID (WABA)", placeholder: "optional" },
  ],
  secretLabel: "Access token",
};

function IntegrationCard({ def, initial }: { def: ChannelDef; initial?: IntegrationSetting }) {
  const [enabled, setEnabled] = useState(initial?.is_enabled ?? false);
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    from_email: initial?.from_email ?? "",
    from_name: initial?.from_name ?? "",
    phone_id: initial?.phone_id ?? "",
    business_account_id: initial?.business_account_id ?? "",
    sms_sender_id: initial?.sms_sender_id ?? "",
  }));
  const [secret, setSecret] = useState("");
  const [secretSet, setSecretSet] = useState(initial?.secret_set ?? false);
  const [last4, setLast4] = useState(initial?.secret_last4 ?? null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    const payload: SaveIntegrationInput = {
      channel: def.channel,
      is_enabled: enabled,
      secret: secret || null,
    };
    for (const f of def.fields) payload[f.key] = values[f.key] || null;

    const res = await saveIntegration(payload);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not save.");

    if (secret.trim()) {
      setSecretSet(true);
      setLast4(secret.trim().slice(-4));
      setSecret("");
    }
    setSaved(true);
  }

  async function clearSecret() {
    setError(null);
    setBusy(true);
    const res = await clearIntegrationSecret(def.channel);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not clear.");
    setSecretSet(false);
    setLast4(null);
    setSecret("");
    setEnabled(false);
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">{def.title}</h2>
          <p className="text-xs text-slate-400">{def.provider}</p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            secretSet ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {secretSet ? `Configured ✓ ••••${last4 ?? ""}` : "Not configured"}
        </span>
      </div>

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
        {def.fields.map((f) => (
          <div key={f.key}>
            <label className="text-xs uppercase tracking-wide text-slate-400">{f.label}</label>
            <input
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        ))}
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">{def.secretLabel}</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={secretSet ? `••••${last4 ?? ""} (leave blank to keep)` : "Paste your key/token"}
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
      </div>

      {def.help && <p className="text-xs text-slate-400">{def.help}</p>}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Enabled (send through this provider)
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {secretSet && (
          <button
            type="button"
            onClick={clearSecret}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            Clear key
          </button>
        )}
      </div>
    </form>
  );
}

export default function IntegrationsClient({ initial }: { initial: IntegrationSetting[] }) {
  const byChannel = Object.fromEntries(initial.map((s) => [s.channel, s])) as Record<
    IntegrationChannel,
    IntegrationSetting | undefined
  >;

  return (
    <div className="space-y-4">
      <IntegrationCard def={EMAIL} initial={byChannel.email} />
      <IntegrationCard def={WHATSAPP} initial={byChannel.whatsapp} />

      {/* SMS scaffold — no live provider wired yet. */}
      <div className="space-y-1 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 opacity-70">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-600">SMS</h2>
            <p className="text-xs text-slate-400">Provider coming soon</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-400">
            Not available
          </span>
        </div>
        <p className="text-xs text-slate-400">
          SMS sending will use the same per-tenant setup once a provider is wired.
        </p>
      </div>
    </div>
  );
}
