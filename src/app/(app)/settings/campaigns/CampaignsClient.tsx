"use client";

import { useState, useTransition } from "react";
import { createCampaign, updateCampaign, deleteCampaign, sendCampaign, type CampaignInput } from "./actions";
import ConditionsEditor from "@/components/settings/ConditionsEditor";
import { ROUTING_LEAD_FIELDS, CONTACT_FIELDS } from "@/lib/routing";
import type { CampaignAudience, EmailCampaign, RoutingCondition } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-500",
  sending: "bg-blue-100 text-blue-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function fieldsFor(audience: CampaignAudience) {
  return audience === "leads" ? ROUTING_LEAD_FIELDS : CONTACT_FIELDS;
}

const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

function CampaignForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: CampaignInput;
  busy: boolean;
  onSave: (data: CampaignInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [audience, setAudience] = useState<CampaignAudience>(initial.audience);
  const [conditions, setConditions] = useState<RoutingCondition[]>(initial.conditions);

  return (
    <div className="space-y-3 rounded-lg border border-brand/30 bg-brand/5 p-4">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" autoFocus className={INPUT} />
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Audience</label>
        <select
          value={audience}
          onChange={(e) => { setAudience(e.target.value as CampaignAudience); setConditions([]); }}
          className={INPUT}
        >
          <option value="leads">Leads</option>
          <option value="contacts">Contacts</option>
        </select>
      </div>
      <ConditionsEditor conditions={conditions} fields={fieldsFor(audience)} onChange={setConditions} emptyLabel="send to every record with an email" />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={INPUT} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Email body — use {{first_name}}, {{last_name}}, {{company}}`}
        rows={5}
        className={INPUT}
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave({ name, subject, body, audience, conditions })}
          disabled={busy || !name.trim() || !subject.trim() || !body.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save campaign"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

function CampaignRow({
  campaign,
  onUpdated,
  onDeleted,
}: {
  campaign: EmailCampaign;
  onUpdated: (c: EmailCampaign) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);

  function handleSave(data: CampaignInput) {
    startTransition(async () => {
      const res = await updateCampaign(campaign.id, data);
      if (!res.ok) { setError(res.error ?? "Failed"); return; }
      onUpdated({ ...campaign, ...data });
      setEditing(false);
      setError(null);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete campaign "${campaign.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteCampaign(campaign.id);
      if (res.ok) onDeleted(campaign.id);
      else setError(res.error ?? "Failed");
    });
  }

  function handleSend() {
    if (!confirm(`Send "${campaign.name}" now? This resolves the audience immediately and starts sending — it can't be undone.`)) return;
    startTransition(async () => {
      const res = await sendCampaign(campaign.id);
      if (!res.ok) { setError(res.error ?? "Failed"); return; }
      setSendResult(`Sending to ${res.recipientCount} recipient(s) — this may take a day or two to fully drain.`);
      onUpdated({ ...campaign, status: "sending", recipient_count: res.recipientCount ?? 0 });
      setError(null);
    });
  }

  if (editing) {
    return <CampaignForm initial={campaign} busy={pending} onSave={handleSave} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">{campaign.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[campaign.status]}`}>{campaign.status}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 capitalize">{campaign.audience}</span>
        {campaign.recipient_count > 0 && (
          <span className="text-xs text-slate-400">
            {campaign.status === "sent" ? `${campaign.sent_count} sent, ${campaign.failed_count} failed` : `${campaign.recipient_count} recipients`}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {campaign.status === "draft" && (
            <>
              <button onClick={handleSend} disabled={pending} className="rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                Send
              </button>
              <button onClick={() => setEditing(true)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                Edit
              </button>
              <button onClick={handleDelete} disabled={pending} className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-1 truncate px-0.5 text-xs text-slate-400">{campaign.subject}</p>
      {sendResult && <p className="mt-1 text-xs text-brand">{sendResult}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const NEW_CAMPAIGN: CampaignInput = { name: "", subject: "", body: "", audience: "leads", conditions: [] };

export default function CampaignsClient({ initialCampaigns }: { initialCampaigns: EmailCampaign[] }) {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>(
    [...initialCampaigns].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCreate(data: CampaignInput) {
    setBusy(true);
    createCampaign(data).then((res) => {
      setBusy(false);
      if (!res.ok || !res.campaign) return setError(res.error ?? "Failed");
      setCampaigns((cs) => [res.campaign!, ...cs]);
      setAdding(false);
      setError(null);
    });
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {campaigns.length === 0 && !adding && <p className="text-sm text-slate-400">No campaigns yet.</p>}

      {campaigns.map((c) => (
        <CampaignRow
          key={c.id}
          campaign={c}
          onUpdated={(updated) => setCampaigns((cs) => cs.map((x) => (x.id === updated.id ? updated : x)))}
          onDeleted={(id) => setCampaigns((cs) => cs.filter((x) => x.id !== id))}
        />
      ))}

      {adding ? (
        <CampaignForm initial={NEW_CAMPAIGN} busy={busy} onSave={handleCreate} onCancel={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand"
        >
          + New campaign
        </button>
      )}
    </div>
  );
}
