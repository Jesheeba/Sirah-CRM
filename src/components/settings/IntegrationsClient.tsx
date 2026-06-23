"use client";

import { useState } from "react";
import {
  clearIntegrationSecret,
  saveIntegration,
  saveWhatsAppCloudConfig,
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

function WhatsAppCloudCard({
  initial,
  cloudWebhookUrl,
  cloudVerifyToken,
}: {
  initial?: IntegrationSetting;
  cloudWebhookUrl: string;
  cloudVerifyToken?: string | null;
}) {
  const [enabled, setEnabled] = useState(initial?.is_enabled ?? false);
  const [phoneId, setPhoneId] = useState(initial?.phone_id ?? "");
  const [wabaId, setWabaId] = useState(initial?.business_account_id ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyTokenInput, setVerifyTokenInput] = useState("");
  const [secretSet, setSecretSet] = useState(initial?.secret_set ?? false);
  const [last4, setLast4] = useState(initial?.secret_last4 ?? null);
  const [appSecretSet, setAppSecretSet] = useState(initial?.app_secret_set ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    const res = await saveWhatsAppCloudConfig({
      is_enabled: enabled,
      phone_id: phoneId || null,
      business_account_id: wabaId || null,
      access_token: accessToken || null,
      app_secret: appSecret || null,
      verify_token: verifyTokenInput || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not save.");
    if (accessToken.trim()) {
      setSecretSet(true);
      setLast4(accessToken.trim().slice(-4));
      setAccessToken("");
    }
    if (appSecret.trim()) {
      setAppSecretSet(true);
      setAppSecret("");
    }
    if (verifyTokenInput.trim()) setVerifyTokenInput("");
    setSaved(true);
  }

  async function clearKey() {
    setError(null);
    setBusy(true);
    const res = await clearIntegrationSecret("whatsapp");
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not clear.");
    setSecretSet(false);
    setLast4(null);
    setAccessToken("");
    setEnabled(false);
  }

  function copyUrl() {
    navigator.clipboard.writeText(cloudWebhookUrl).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  }

  function copyToken() {
    if (!cloudVerifyToken) return;
    navigator.clipboard.writeText(cloudVerifyToken).then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    });
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">WhatsApp Cloud API</h2>
          <p className="text-xs text-slate-400">Meta Official — send + receive</p>
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
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Phone number ID</label>
          <input
            value={phoneId}
            onChange={(e) => setPhoneId(e.target.value)}
            placeholder="1234567890"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Business account ID (WABA)
          </label>
          <input
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder="optional"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Access token (secret)
          </label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={
              secretSet
                ? `••••${last4 ?? ""} (leave blank to keep)`
                : "Paste your permanent token"
            }
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            App secret (secret)
          </label>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={
              appSecretSet ? "•••• set (leave blank to keep)" : "Paste your Meta app secret"
            }
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Verify token (set once, then copy to Meta)
          </label>
          <input
            value={verifyTokenInput}
            onChange={(e) => setVerifyTokenInput(e.target.value)}
            placeholder={
              cloudVerifyToken ? "•••• set (leave blank to keep)" : "Enter any secret string"
            }
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        {cloudVerifyToken && (
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Verify token (copy → Meta)
            </label>
            <div className="mt-1 flex gap-1">
              <input
                readOnly
                value={cloudVerifyToken}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={copyToken}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                {copiedToken ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Webhook URL (copy → Meta)
          </label>
          <div className="mt-1 flex gap-1">
            <input
              readOnly
              value={cloudWebhookUrl}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 outline-none"
            />
            <button
              type="button"
              onClick={copyUrl}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
            >
              {copiedUrl ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Meta → WhatsApp → Configuration. Subscribe to the{" "}
            <span className="font-mono">messages</span> field.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Enabled (send and receive through Meta Cloud API)
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
            onClick={clearKey}
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

function WhatsAppDeviceCard({
  initial,
  webhookUrl,
}: {
  initial?: IntegrationSetting;
  webhookUrl?: string | null;
}) {
  const [enabled, setEnabled] = useState(initial?.is_enabled ?? false);
  const [apiEndpoint, setApiEndpoint] = useState(
    initial?.api_endpoint ?? "https://api.ultramsg.com",
  );
  const [phoneId, setPhoneId] = useState(initial?.phone_id ?? "");
  const [secret, setSecret] = useState("");
  const [secretSet, setSecretSet] = useState(initial?.secret_set ?? false);
  const [last4, setLast4] = useState(initial?.secret_last4 ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    const res = await saveIntegration({
      channel: "whatsapp_device",
      is_enabled: enabled,
      api_endpoint: apiEndpoint || null,
      phone_id: phoneId || null,
      secret: secret || null,
    });
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
    const res = await clearIntegrationSecret("whatsapp_device");
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not clear.");
    setSecretSet(false);
    setLast4(null);
    setSecret("");
    setEnabled(false);
  }

  function copyWebhookUrl() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">WhatsApp Device</h2>
          <p className="text-xs text-slate-400">UltraMsg-compatible (send + receive)</p>
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
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Provider base URL</label>
          <input
            value={apiEndpoint}
            onChange={(e) => setApiEndpoint(e.target.value)}
            placeholder="https://api.ultramsg.com"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Instance ID</label>
          <input
            value={phoneId}
            onChange={(e) => setPhoneId(e.target.value)}
            placeholder="instance12345"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Token (secret)</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              secretSet ? `••••${last4 ?? ""} (leave blank to keep)` : "Paste your UltraMsg token"
            }
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        {webhookUrl && (
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Inbound webhook URL
            </label>
            <div className="mt-1 flex gap-1">
              <input
                readOnly
                value={webhookUrl}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Paste into UltraMsg → Settings → Webhook URL.
            </p>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Enabled (send and receive through this device)
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
            Clear token
          </button>
        )}
      </div>
    </form>
  );
}

export default function IntegrationsClient({
  initial,
  webhookUrl,
  cloudWebhookUrl,
  cloudVerifyToken,
}: {
  initial: IntegrationSetting[];
  webhookUrl?: string | null;
  cloudWebhookUrl: string;
  cloudVerifyToken?: string | null;
}) {
  const byChannel = Object.fromEntries(initial.map((s) => [s.channel, s])) as Record<
    IntegrationChannel,
    IntegrationSetting | undefined
  >;

  return (
    <div className="space-y-4">
      <IntegrationCard def={EMAIL} initial={byChannel.email} />
      <WhatsAppCloudCard
        initial={byChannel.whatsapp}
        cloudWebhookUrl={cloudWebhookUrl}
        cloudVerifyToken={cloudVerifyToken}
      />
      <WhatsAppDeviceCard initial={byChannel.whatsapp_device} webhookUrl={webhookUrl} />

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
