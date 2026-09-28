"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  setInstagramCommentAutomationEnabled,
  upsertInstagramCommentRule,
  deleteInstagramCommentRule,
} from "@/app/(app)/settings/integrations/instagram-actions";
import type { MetaLeadPage } from "@/lib/types";
import type {
  InstagramCommentRule,
  InstagramCommentRuleType,
  InstagramCommentActionType,
} from "@/lib/instagram-comment-automation";

const RULE_LABELS: Record<InstagramCommentRuleType, string> = {
  keyword: "Keyword match",
  always: "Every comment (catch-all)",
};

const ACTION_LABELS: Record<InstagramCommentActionType, string> = {
  comment_reply: "Public reply under the comment",
  private_reply: "Private DM to the commenter",
  both: "Both — public reply + DM",
};

type Draft = Omit<InstagramCommentRule, "id"> & { page_id: string; id?: string };

function emptyDraft(pageId: string): Draft {
  return {
    page_id: pageId,
    ig_media_id: null,
    rule_type: "always",
    priority: 100,
    is_enabled: true,
    match_keywords: [],
    action_type: "private_reply",
    reply_text: null,
    dm_text: null,
  };
}

export default function InstagramCommentCard({
  pages,
  rulesByPage,
}: {
  /** Only pages with a linked Instagram Business Account are shown. */
  pages: MetaLeadPage[];
  rulesByPage: Record<string, InstagramCommentRule[]>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const igPages = pages.filter((p) => p.ig_business_id);
  if (!igPages.length) return null;

  async function toggle(page: MetaLeadPage, enabled: boolean) {
    setError(null);
    setBusy(page.page_id);
    const res = await setInstagramCommentAutomationEnabled(page.page_id, enabled);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Could not update.");
    else router.refresh();
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    setBusy(draft.page_id);
    const res = await upsertInstagramCommentRule({
      id: draft.id,
      page_id: draft.page_id,
      ig_media_id: draft.ig_media_id,
      rule_type: draft.rule_type,
      priority: draft.priority,
      is_enabled: draft.is_enabled,
      match_keywords: draft.match_keywords,
      action_type: draft.action_type,
      reply_text: draft.reply_text,
      dm_text: draft.dm_text,
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
    const res = await deleteInstagramCommentRule(id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Could not delete rule.");
    else router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Instagram Comment Automation</h2>
          <p className="text-xs text-slate-400">
            Auto-reply to comments, or DM the commenter — scope a rule to one reel/post, or leave it page-wide.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

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
                      checked={page.ig_comment_automation_enabled}
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
                        <p className="truncate text-xs text-slate-400">
                          {r.ig_media_id ? `reel/post ${r.ig_media_id}` : "every post/reel"} · {ACTION_LABELS[r.action_type]}
                        </p>
                        {r.match_keywords.length > 0 && (
                          <p className="truncate text-xs text-slate-400">keywords: {r.match_keywords.join(", ")}</p>
                        )}
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

      <p className="text-xs text-slate-400">
        Leave &quot;Only this reel/post&quot; blank to match comments anywhere on the page — a rule scoped to a
        specific reel always wins over a page-wide one. Requires the <span className="font-mono">instagram_manage_comments</span>{" "}
        permission (part of the same &quot;Connect Instagram&quot; grant as DM automation).
      </p>
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
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.rule_type}
          onChange={(e) => setDraft({ ...draft, rule_type: e.target.value as InstagramCommentRuleType })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(RULE_LABELS) as InstagramCommentRuleType[]).map((t) => (
            <option key={t} value={t}>
              {RULE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          value={draft.action_type}
          onChange={(e) => setDraft({ ...draft, action_type: e.target.value as InstagramCommentActionType })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(ACTION_LABELS) as InstagramCommentActionType[]).map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
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
      </div>

      <input
        type="text"
        placeholder="Only this reel/post — Instagram media id (leave blank to match every post/reel)"
        value={draft.ig_media_id ?? ""}
        onChange={(e) => setDraft({ ...draft, ig_media_id: e.target.value.trim() || null })}
        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
      />

      {draft.rule_type === "keyword" && (
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

      {(draft.action_type === "comment_reply" || draft.action_type === "both") && (
        <textarea
          placeholder="Public reply posted under the comment"
          value={draft.reply_text ?? ""}
          onChange={(e) => setDraft({ ...draft, reply_text: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      )}

      {(draft.action_type === "private_reply" || draft.action_type === "both") && (
        <textarea
          placeholder="Private DM sent to the commenter"
          value={draft.dm_text ?? ""}
          onChange={(e) => setDraft({ ...draft, dm_text: e.target.value })}
          rows={2}
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
