"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  deleteIgRule,
  listIgPosts,
  saveAutomationSettings,
  saveIgRule,
  setIgRuleEnabled,
  testIgRules,
  type PostListResult,
  type RuleTestResult,
} from "@/app/(app)/social/rules/actions";
import type { IgRule, RuleAction, RuleAppliesTo } from "@/lib/ig-rules";

type Draft = Omit<IgRule, "id" | "match_keywords"> & { id?: string; keywordsText: string };

const ACTIONS: Record<RuleAppliesTo, [RuleAction, string][]> = {
  comment: [["public_reply", "Public reply"], ["private_reply", "Private reply (DM)"], ["both", "Both"]],
  mention: [["public_reply", "Public reply"]],
  dm: [["dm_reply", "Message reply"]],
};
const APPLIES: Record<RuleAppliesTo, string> = { comment: "Comments", mention: "Mentions", dm: "Messages" };

const blank = (): Draft => ({
  name: "",
  ig_account_id: null,
  applies_to: "comment",
  ig_media_id: null,
  rule_type: "keyword",
  keywordsText: "",
  match_mode: "any",
  whole_word: true,
  priority: 100,
  is_enabled: true,
  action: "public_reply",
  reply_text: "",
  dm_text: "",
  send_mode: "needs_approval",
});

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

export default function RulesManager({
  rules,
  accounts,
  settings,
  initialMediaId = null,
}: {
  rules: IgRule[];
  /** From `?media=` (the comment page's "rule for this post" link): open a new rule tied to that post. */
  initialMediaId?: string | null;
  accounts: { id: string; username: string | null }[];
  settings: { blocklist: string[]; autoPaused: boolean; hourlyCap: number; dailyCap: number };
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(initialMediaId ? { ...blank(), ig_media_id: initialMediaId } : null);
  const [posts, setPosts] = useState<PostListResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IgRule | null>(null);
  const [safety, setSafety] = useState({ blocklist: settings.blocklist.join("\n"), autoPaused: settings.autoPaused, hourlyCap: settings.hourlyCap, dailyCap: settings.dailyCap });
  const [test, setTest] = useState<{ kind: RuleAppliesTo; text: string }>({ kind: "comment", text: "" });
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);

  async function loadPosts() {
    if (posts?.ok || busy === "posts") return;
    setBusy("posts");
    setPosts(await listIgPosts().catch(() => ({ ok: false, posts: [], error: "Could not load posts." })));
    setBusy(null);
  }
  // Rules limited to a post show its caption, so fetch the post list once when any exist.
  useEffect(() => {
    if (initialMediaId || rules.some((r) => r.ig_media_id)) void loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const postById = (id: string | null) => (id ? posts?.posts.find((p) => p.id === id) : undefined);
  const postLabel = (id: string) => {
    const p = postById(id);
    return p ? (p.caption?.slice(0, 40) || `${p.mediaType === "VIDEO" ? "Reel" : "Post"} of ${p.timestamp?.slice(0, 10) ?? ""}`) : "one post";
  };

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setError(null);
    setNotice(null);
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return false;
    }
    if (done) setNotice(done);
    router.refresh();
    return true;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const { keywordsText, ...rest } = draft;
    const ok = await run("save", () => saveIgRule({ ...rest, match_keywords: keywordsText.split(/[\n,]/) }), "Rule saved.");
    if (ok) setDraft(null);
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const showPublic = draft && (draft.action === "public_reply" || draft.action === "both");
  const showDm = draft && draft.action !== "public_reply";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Automatic replies</h1>
          <p className="text-sm text-slate-500">Keyword rules answer common questions. Choose per rule whether it posts by itself or waits for approval.</p>
        </div>
        {!draft && (
          <button onClick={() => setDraft(blank())} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            + New rule
          </button>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {/* Safety ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="safety-title">
        <h2 id="safety-title" className="text-sm font-semibold text-slate-700">Safety</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={safety.autoPaused} onChange={(e) => setSafety({ ...safety, autoPaused: e.target.checked })} />
              <span>
                <strong>Pause all automatic replies</strong> — matching rules wait for approval instead
              </span>
            </label>
            <div className="flex flex-wrap gap-3 text-sm text-slate-700">
              <label className="flex items-center gap-1">
                Max per hour
                <input type="number" min={0} max={1000} value={safety.hourlyCap} onChange={(e) => setSafety({ ...safety, hourlyCap: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-300 px-2 py-1" />
              </label>
              <label className="flex items-center gap-1">
                Max per day
                <input type="number" min={0} max={10000} value={safety.dailyCap} onChange={(e) => setSafety({ ...safety, dailyCap: Number(e.target.value) })} className="w-24 rounded-lg border border-slate-300 px-2 py-1" />
              </label>
            </div>
            <p className="text-xs text-slate-500">Over a limit, or the same person within 10 minutes, a rule&apos;s reply waits for approval.</p>
          </div>
          <label className="block text-sm text-slate-700">
            Blocklist — any of these words always goes to a person (one per line)
            <textarea rows={4} value={safety.blocklist} onChange={(e) => setSafety({ ...safety, blocklist: e.target.value })} className={`${input} mt-1`} placeholder={"complaint\nbribe\nelection"} />
          </label>
        </div>
        <button
          onClick={() => run("safety", () => saveAutomationSettings(safety), "Safety settings saved.")}
          disabled={busy === "safety"}
          className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "safety" ? "Saving…" : "Save safety settings"}
        </button>
      </section>

      {/* Test ------------------------------------------------------------------ */}
      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="test-title">
        <h2 id="test-title" className="text-sm font-semibold text-slate-700">Test a comment</h2>
        <p className="text-xs text-slate-500">See which rule would fire and what it would send. Nothing is posted.</p>
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("test");
            setTestResult(await testIgRules(test));
            setBusy(null);
          }}
        >
          <select value={test.kind} onChange={(e) => setTest({ ...test, kind: e.target.value as RuleAppliesTo })} aria-label="Test as" className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
            {Object.entries(APPLIES).map(([k, v]) => (
              <option key={k} value={k}>{v.slice(0, -1)}</option>
            ))}
          </select>
          <input value={test.text} onChange={(e) => setTest({ ...test, text: e.target.value })} placeholder="e.g. what are the office timings?" aria-label="Sample text" className={`${input} min-w-[14rem] flex-1`} />
          <button type="submit" disabled={busy === "test" || !test.text.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Test
          </button>
        </form>
        {testResult && (
          <div role="status" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {!testResult.ok ? (
              <p className="text-red-700">{testResult.error}</p>
            ) : (
              <>
                <p className={testResult.outcome === "blocked" ? "font-medium text-amber-800" : "font-medium"}>{testResult.detail}</p>
                {testResult.replies?.map((r, i) => (
                  <p key={i} className="mt-1 text-slate-600">
                    <span className="text-xs uppercase text-slate-400">{r.channel}</span> {r.body}
                  </p>
                ))}
                {testResult.outcome === "match" && (
                  <p className="mt-1 text-xs text-slate-500">{testResult.sendMode === "auto" ? "Would post automatically." : "Would wait for approval."}</p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Editor ---------------------------------------------------------------- */}
      {draft && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-brand/30 bg-white p-5" aria-label={draft.id ? "Edit rule" : "New rule"}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-700 sm:col-span-2">
              Name
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className={`${input} mt-1`} placeholder="Office address" />
            </label>
            <label className="text-sm text-slate-700">
              Answers
              <select
                value={draft.applies_to}
                onChange={(e) => {
                  const a = e.target.value as RuleAppliesTo;
                  set({ applies_to: a, action: ACTIONS[a][0][0] });
                }}
                className={`${input} mt-1`}
              >
                {Object.entries(APPLIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          <fieldset className="flex flex-wrap gap-4 text-sm text-slate-700">
            <legend className="sr-only">Match</legend>
            <label className="flex items-center gap-1"><input type="radio" checked={draft.rule_type === "keyword"} onChange={() => set({ rule_type: "keyword" })} /> When it contains keywords</label>
            <label className="flex items-center gap-1"><input type="radio" checked={draft.rule_type === "always"} onChange={() => set({ rule_type: "always" })} /> Always (catch-all)</label>
          </fieldset>

          {draft.rule_type === "keyword" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-700 sm:col-span-2">
                Keywords (one per line or comma-separated — any language)
                <textarea rows={3} value={draft.keywordsText} onChange={(e) => set({ keywordsText: e.target.value })} className={`${input} mt-1`} placeholder={"office, address, எங்கே"} />
              </label>
              <div className="space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-1"><input type="radio" checked={draft.match_mode === "any"} onChange={() => set({ match_mode: "any" })} /> Any keyword</label>
                <label className="flex items-center gap-1"><input type="radio" checked={draft.match_mode === "all"} onChange={() => set({ match_mode: "all" })} /> All keywords</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={draft.whole_word} onChange={(e) => set({ whole_word: e.target.checked })} /> Whole words only</label>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-700">
              Reply type
              <select value={draft.action} onChange={(e) => set({ action: e.target.value as RuleAction })} className={`${input} mt-1`}>
                {ACTIONS[draft.applies_to].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              When it matches
              <select value={draft.send_mode} onChange={(e) => set({ send_mode: e.target.value as Draft["send_mode"] })} className={`${input} mt-1`}>
                <option value="needs_approval">Wait for approval</option>
                <option value="auto">Post automatically</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Priority (lower runs first)
              <input type="number" min={0} max={10000} value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })} className={`${input} mt-1`} />
            </label>
          </div>

          {showPublic && (
            <label className="block text-sm text-slate-700">
              Public reply
              <textarea rows={3} maxLength={2200} value={draft.reply_text ?? ""} onChange={(e) => set({ reply_text: e.target.value })} className={`${input} mt-1`} />
            </label>
          )}
          {showDm && (
            <label className="block text-sm text-slate-700">
              Message text
              <textarea rows={3} maxLength={1000} value={draft.dm_text ?? ""} onChange={(e) => set({ dm_text: e.target.value })} className={`${input} mt-1`} />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.length > 1 && (
              <label className="text-sm text-slate-700">
                Account
                <select value={draft.ig_account_id ?? ""} onChange={(e) => set({ ig_account_id: e.target.value || null })} className={`${input} mt-1`}>
                  <option value="">All connected accounts</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
                </select>
              </label>
            )}
            {draft.applies_to === "comment" && (
              <label className="text-sm text-slate-700">
                Only on one post (optional)
                <input value={draft.ig_media_id ?? ""} onChange={(e) => set({ ig_media_id: e.target.value })} className={`${input} mt-1`} placeholder="Leave empty for every post — or choose below" />
              </label>
            )}
          </div>

          {draft.applies_to === "comment" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setPickerOpen((o) => !o); void loadPosts(); }}
                  aria-expanded={pickerOpen}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {pickerOpen ? "Hide posts" : "Choose from recent posts"}
                </button>
                {draft.ig_media_id && (
                  <>
                    <span className="text-sm text-slate-600">Only on: <strong>{postLabel(draft.ig_media_id)}</strong></span>
                    <button type="button" onClick={() => set({ ig_media_id: null })} className="text-sm text-slate-500 underline hover:text-slate-700">
                      Every post
                    </button>
                  </>
                )}
              </div>
              {pickerOpen && (
                busy === "posts" ? (
                  <p className="text-sm text-slate-500" role="status">Loading posts…</p>
                ) : posts && !posts.ok ? (
                  <p className="text-sm text-red-600" role="alert">{posts.error}</p>
                ) : posts && posts.posts.length === 0 ? (
                  <p className="text-sm text-slate-500">No posts found on the connected account.</p>
                ) : (
                  <ul className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6" aria-label="Recent posts">
                    {(posts?.posts ?? []).map((p) => {
                      const chosen = draft.ig_media_id === p.id;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => { set({ ig_media_id: p.id }); setPickerOpen(false); }}
                            aria-pressed={chosen}
                            className={`w-full overflow-hidden rounded-lg border text-left ${chosen ? "border-brand ring-2 ring-brand" : "border-slate-200 hover:border-slate-400"}`}
                          >
                            {p.thumbnail ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.thumbnail} alt="" className="aspect-square w-full bg-slate-100 object-cover" loading="lazy" />
                            ) : (
                              <div className="flex aspect-square w-full items-center justify-center bg-slate-100 text-xs text-slate-400">No preview</div>
                            )}
                            <span className="block truncate px-2 pt-1 text-xs text-slate-700">{p.caption || "(no caption)"}</span>
                            <span className="block px-2 pb-1 text-[11px] text-slate-400">
                              {p.mediaType === "VIDEO" ? "Reel" : p.mediaType === "CAROUSEL_ALBUM" ? "Carousel" : "Post"} · {p.timestamp?.slice(0, 10)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={busy === "save"} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy === "save" ? "Saving…" : "Save rule"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* List ------------------------------------------------------------------ */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white" aria-label="Rules">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3">Answers</th>
              <th className="px-4 py-3">Matches</th>
              <th className="px-4 py-3">Then</th>
              <th className="px-4 py-3">On</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rules.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No rules yet — add one for your most common question.</td></tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}<p className="text-xs font-normal text-slate-400">priority {r.priority}{r.ig_media_id ? ` · only on: ${postLabel(r.ig_media_id)}` : ""}</p></td>
                <td className="px-4 py-3 text-slate-600">{APPLIES[r.applies_to]}</td>
                <td className="max-w-xs px-4 py-3 text-slate-600">{r.rule_type === "always" ? "Everything" : `${r.match_mode === "all" ? "All of" : "Any of"}: ${r.match_keywords.join(", ")}`}</td>
                <td className="px-4 py-3 text-slate-600">{r.send_mode === "auto" ? "Posts automatically" : "Waits for approval"}</td>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={r.is_enabled} aria-label={`Rule ${r.name} enabled`} onChange={(e) => run(r.id, () => setIgRuleEnabled(r.id, e.target.checked))} disabled={busy === r.id} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setDraft({ ...r, keywordsText: r.match_keywords.join("\n") })} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Edit</button>
                    <button onClick={() => setConfirmDelete(r)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this rule?"
          message={`"${confirmDelete.name}" will stop answering. Replies it already sent stay in the history.`}
          confirmLabel="Delete rule"
          busy={busy === "delete"}
          onConfirm={async () => {
            await run("delete", () => deleteIgRule(confirmDelete.id), "Rule deleted.");
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
