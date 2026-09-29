"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  setInstagramDmEnabled,
  upsertInstagramRule,
  deleteInstagramRule,
  disconnectInstagram,
} from "@/app/(app)/settings/integrations/instagram-actions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { MetaLeadPage } from "@/lib/types";
import type { InstagramAutomationRule, InstagramRuleType } from "@/lib/instagram-automation";

const RULE_LABELS: Record<InstagramRuleType, string> = {
  keyword: "Keyword auto-reply",
  menu: "Button / menu",
  handoff: "Hand off to a human",
  ai_fallback: "AI-drafted fallback",
  always: "Always reply (catch-all)",
};

function emptyDraft(pageId: string): Omit<InstagramAutomationRule, "id"> & { page_id: string } {
  return {
    page_id: pageId,
    rule_type: "keyword",
    priority: 100,
    is_enabled: true,
    match_keywords: [],
    reply_text: "",
    reply_buttons: null,
    payload: null,
    ai_system_prompt: null,
    require_follower: false,
    reply_image_url: null,
    reply_link_url: null,
    reply_link_title: null,
  };
}

const REASONS: Record<string, string> = {
  unconfigured: "Meta app not configured yet — set META_APP_ID / META_APP_SECRET in the server env.",
  denied: "You cancelled or denied the Instagram permission.",
  state: "Security check failed. Please try connecting again.",
  nopages: "No Facebook Pages were found on that account.",
  noig: "None of your Facebook Pages have a linked Instagram Business Account yet — link one in Meta Business Suite, then try again.",
  save: "Couldn't save the connected page(s). Please try again.",
  oauth: "Instagram sign-in failed. Please try again.",
};

export default function InstagramDmCard({
  pages,
  rulesByPage,
  aiConfigured,
  configured,
  notice,
  reason,
  connectedCount,
}: {
  /** Only pages with a linked Instagram Business Account are shown. */
  pages: MetaLeadPage[];
  rulesByPage: Record<string, InstagramAutomationRule[]>;
  aiConfigured: boolean;
  configured: boolean;
  notice: string | null;
  reason: string | null;
  connectedCount: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<string | null>(null);
  const [draft, setDraft] = useState<(Omit<InstagramAutomationRule, "id"> & { page_id: string; id?: string }) | null>(null);
  const [confirmPage, setConfirmPage] = useState<MetaLeadPage | null>(null);

  const igPages = pages.filter((p) => p.ig_business_id);

  async function confirmDisconnect() {
    if (!confirmPage) return;
    setError(null);
    setBusy(confirmPage.page_id);
    const res = await disconnectInstagram(confirmPage.page_id);
    setBusy(null);
    setConfirmPage(null);
    if (!res.ok) setError(res.error ?? "Could not disconnect.");
    else router.refresh();
  }

  async function toggle(page: MetaLeadPage, enabled: boolean) {
    setError(null);
    setBusy(page.page_id);
    const res = await setInstagramDmEnabled(page.page_id, enabled);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Could not update.");
    else router.refresh();
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    setBusy(draft.page_id);
    const res = await upsertInstagramRule({
      id: draft.id,
      page_id: draft.page_id,
      rule_type: draft.rule_type,
      priority: draft.priority,
      is_enabled: draft.is_enabled,
      match_keywords: draft.match_keywords,
      reply_text: draft.reply_text,
      reply_buttons: draft.reply_buttons,
      payload: draft.payload,
      ai_system_prompt: draft.ai_system_prompt,
      require_follower: draft.require_follower ?? false,
      reply_image_url: draft.reply_image_url ?? null,
      reply_link_url: draft.reply_link_url ?? null,
      reply_link_title: draft.reply_link_title ?? null,
    });
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Could not save rule.");
    else {
      setDraft(null);
      router.refresh();
    }
  }

  async function removeRule(id: string, pageId: string) {
    setError(null);
    setBusy(pageId);
    const res = await deleteInstagramRule(id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Could not delete rule.");
    else router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Instagram DM Automation</h2>
          <p className="text-xs text-slate-400">Auto-reply to Instagram DMs on your connected pages</p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            igPages.length ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {igPages.length ? `${igPages.length} page${igPages.length > 1 ? "s" : ""} connected` : "Not connected"}
        </span>
      </div>

      {notice === "connected" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Connected {connectedCount ?? ""} page{connectedCount === "1" ? "" : "s"} with Instagram DM enabled.
        </div>
      )}
      {notice === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(reason && REASONS[reason]) ?? "Something went wrong connecting Instagram."}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {!aiConfigured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ANTHROPIC_API_KEY isn&apos;t set — AI-drafted fallback replies won&apos;t send until it is.
        </p>
      )}

      {!igPages.length && (
        <p className="text-xs text-slate-400">
          Connect a Facebook Page with a linked Instagram Business Account to start auto-replying to
          Instagram DMs.
        </p>
      )}

      {igPages.length > 0 && (
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {igPages.map((page) => {
          const rules = (rulesByPage[page.page_id] ?? []).slice().sort((a, b) => a.priority - b.priority);
          const isOpen = openPage === page.page_id;
          return (
            <div key={page.page_id} className="p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium text-slate-700">{page.page_name || "Facebook Page"}</span>
                  <p className="font-mono text-xs text-slate-400">IG {page.ig_business_id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={page.ig_dm_enabled}
                      onChange={(e) => toggle(page, e.target.checked)}
                      disabled={busy === page.page_id}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    onClick={() => setOpenPage(isOpen ? null : page.page_id)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    {isOpen ? "Hide rules" : `Rules (${rules.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPage(page)}
                    disabled={busy === page.page_id}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {rules.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700">{RULE_LABELS[r.rule_type]}</span>
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${r.is_enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                          {r.is_enabled ? "On" : "Off"}
                        </span>
                        {r.match_keywords.length > 0 && (
                          <p className="truncate text-xs text-slate-400">keywords: {r.match_keywords.join(", ")}</p>
                        )}
                        {r.reply_text && <p className="truncate text-xs text-slate-400">reply: {r.reply_text}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => setDraft({ ...r, page_id: page.page_id })} className="text-xs text-blue-600 hover:underline">
                          Edit
                        </button>
                        <button type="button" onClick={() => removeRule(r.id, page.page_id)} className="text-xs text-red-600 hover:underline">
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}

                  {draft && draft.page_id === page.page_id ? (
                    <RuleEditor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setDraft(null)} busy={busy === page.page_id} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDraft(emptyDraft(page.page_id))}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100"
                    >
                      + Add rule
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* Connect button */}
      {configured ? (
        <a
          href="/api/meta/oauth/start?intent=instagram"
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          {igPages.length ? "Connect another Instagram account" : "Connect Instagram"}
        </a>
      ) : (
        <p className="text-xs text-slate-400">
          Set <span className="font-mono">META_APP_ID</span> and{" "}
          <span className="font-mono">META_APP_SECRET</span> in the server environment to enable the
          Connect Instagram button.
        </p>
      )}

      {igPages.length > 0 && (
        <p className="text-xs text-slate-400">
          Rules run in priority order (lowest first): a quick-reply tap or a keyword match wins first, then the
          AI fallback (if enabled). A &quot;Hand off to a human&quot; rule pauses automation for that
          conversation until a rep replies and switches it back to bot mode.
        </p>
      )}

      <ConfirmDialog
        open={Boolean(confirmPage)}
        title="Disconnect Instagram?"
        message={`DM/comment automation for "${confirmPage?.page_name || confirmPage?.page_id}" will stop, and its rules will be deleted. Its Facebook Lead Ads connection (if any) is not affected.`}
        confirmLabel="Disconnect"
        busy={busy !== null && busy === confirmPage?.page_id}
        onConfirm={confirmDisconnect}
        onCancel={() => setConfirmPage(null)}
      />
    </div>
  );
}

function RuleEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
}: {
  draft: Omit<InstagramAutomationRule, "id"> & { page_id: string; id?: string };
  setDraft: (d: (Omit<InstagramAutomationRule, "id"> & { page_id: string; id?: string }) | null) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.rule_type}
          onChange={(e) => setDraft({ ...draft, rule_type: e.target.value as InstagramRuleType })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(RULE_LABELS) as InstagramRuleType[]).map((t) => (
            <option key={t} value={t}>
              {RULE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={draft.priority}
          onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
          title="Priority (lower runs first)"
          className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={draft.is_enabled}
            onChange={(e) => setDraft({ ...draft, is_enabled: e.target.checked })}
          />
          Enabled
        </label>
        {draft.rule_type !== "ai_fallback" && (
          <label className="flex items-center gap-1 text-xs text-slate-500" title="Only send this reply to users who already follow the connected account">
            <input
              type="checkbox"
              checked={draft.require_follower ?? false}
              onChange={(e) => setDraft({ ...draft, require_follower: e.target.checked })}
            />
            Only if follower
          </label>
        )}
      </div>

      {(draft.rule_type === "keyword" || draft.rule_type === "handoff" || draft.rule_type === "menu") && (
        <input
          type="text"
          placeholder="Keywords, comma-separated (e.g. price, cost, pricing)"
          value={draft.match_keywords.join(", ")}
          onChange={(e) =>
            setDraft({ ...draft, match_keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })
          }
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      )}

      {draft.rule_type !== "ai_fallback" && (
        <textarea
          placeholder="Reply text"
          value={draft.reply_text ?? ""}
          onChange={(e) => setDraft({ ...draft, reply_text: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      )}

      {draft.rule_type !== "ai_fallback" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="url"
            placeholder="Image URL to send (optional)"
            value={draft.reply_image_url ?? ""}
            onChange={(e) => setDraft({ ...draft, reply_image_url: e.target.value || null })}
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Link URL (optional)"
              value={draft.reply_link_url ?? ""}
              onChange={(e) => setDraft({ ...draft, reply_link_url: e.target.value || null })}
              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              type="text"
              placeholder="Link label"
              value={draft.reply_link_title ?? ""}
              onChange={(e) => setDraft({ ...draft, reply_link_title: e.target.value || null })}
              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}

      {draft.rule_type === "menu" && (
        <input
          type="text"
          placeholder='Buttons as "Title:payload" pairs, comma-separated (e.g. Pricing:pricing, Support:support)'
          value={(draft.reply_buttons ?? []).map((b) => `${b.title}:${b.payload}`).join(", ")}
          onChange={(e) =>
            setDraft({
              ...draft,
              reply_buttons: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => {
                  const [title, payload] = s.split(":");
                  return { title: (title ?? "").trim(), payload: (payload ?? title ?? "").trim() };
                }),
            })
          }
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      )}

      {(draft.rule_type === "menu" || draft.rule_type === "handoff") && (
        <input
          type="text"
          placeholder="Payload this rule responds to when a quick-reply button is tapped (optional)"
          value={draft.payload ?? ""}
          onChange={(e) => setDraft({ ...draft, payload: e.target.value || null })}
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      )}

      {draft.rule_type === "ai_fallback" && (
        <textarea
          placeholder="System prompt — instructions + persona for the AI-drafted reply"
          value={draft.ai_system_prompt ?? ""}
          onChange={(e) => setDraft({ ...draft, ai_system_prompt: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save rule"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
