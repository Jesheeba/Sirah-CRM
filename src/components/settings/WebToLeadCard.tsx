"use client";

import { useState } from "react";
import { regenerateCaptureToken } from "@/app/(app)/settings/integrations/lead-capture-actions";

export default function WebToLeadCard({ captureUrl }: { captureUrl: string }) {
  const [url, setUrl] = useState(captureUrl);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback — select the text
    }
  }

  async function regen() {
    if (!confirm("Regenerate the token? Your current capture URL will stop working immediately.")) return;
    setBusy(true);
    setError(null);
    const res = await regenerateCaptureToken();
    setBusy(false);
    if (res.ok && res.url) setUrl(res.url);
    else setError(res.error ?? "Failed to regenerate.");
  }

  const snippet = `<!-- Paste inside your landing page form tag -->
<form action="${url}" method="POST">
  <input name="first_name" placeholder="First name" />
  <input name="last_name"  placeholder="Last name" />
  <input name="email"      type="email" placeholder="Email" required />
  <input name="phone"      placeholder="Phone" />
  <button type="submit">Submit</button>
</form>`;

  const jsSnippet = `// JavaScript / fetch example (e.g. from a React form)
await fetch("${url}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    first_name: "Jane",
    last_name:  "Smith",
    email:      "jane@example.com",
    phone:      "+971501234567",
    city:       "Dubai",      // any extra fields → stored in lead custom data
  }),
});`;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Web-to-Lead · Landing Pages</h2>
          <p className="text-xs text-slate-400">
            POST to this URL from any landing page form — leads appear in the CRM instantly
          </p>
        </div>
        <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
          Active
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">Your capture URL</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {url}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <strong className="text-slate-700">Supported fields:</strong>{" "}
        <span className="font-mono">first_name</span>, <span className="font-mono">last_name</span>,{" "}
        <span className="font-mono">email</span>, <span className="font-mono">phone</span>,{" "}
        <span className="font-mono">company</span> — plus any extra fields you add (e.g.{" "}
        <span className="font-mono">city</span>, <span className="font-mono">message</span>). Extra fields
        are stored in the lead&apos;s custom data and visible on the lead record.
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:underline">
          Show HTML form snippet
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          {snippet}
        </pre>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:underline">
          Show JavaScript / fetch snippet
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          {jsSnippet}
        </pre>
      </details>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <p className="text-xs text-slate-400">
          Treat this URL as a secret — anyone with it can submit leads to your account.
        </p>
        <button
          type="button"
          onClick={regen}
          disabled={busy}
          className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Regenerate token"}
        </button>
      </div>
    </div>
  );
}
