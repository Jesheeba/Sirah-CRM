import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { formatWhen } from "@/lib/social-list";

const COLS = "id, kind, author_id, author_handle, text, permalink, media_id, parent_id, provider_id, ig_account_id, created_at_provider, received_at, status";
type Row = {
  id: string;
  kind: string;
  author_id: string | null;
  author_handle: string | null;
  text: string | null;
  permalink: string | null;
  media_id: string | null;
  parent_id: string | null;
  provider_id: string;
  ig_account_id: string;
  created_at_provider: string | null;
  received_at: string;
  status: string;
};

/** One interaction with its context: the DM history with that person, or the comment's thread. */
export default async function SocialItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = (await getUserContext())!;
  const [{ data }, { data: tenant }] = await Promise.all([
    supabase.from("ig_interactions").select(COLS).eq("id", id).maybeSingle(),
    supabase.from("tenants").select("timezone").eq("id", ctx.tenantId!).maybeSingle(),
  ]);
  if (!data) notFound();
  const it = data as Row;
  const tz = (tenant?.timezone as string | null) || "Asia/Kolkata";
  const when = (iso: string | null) => formatWhen(iso, tz, true);

  // Context. RLS keeps all of this inside the tenant.
  let thread: Row[] = [];
  if (it.kind === "dm" && it.author_id) {
    const { data: t } = await supabase
      .from("ig_interactions")
      .select(COLS)
      .eq("ig_account_id", it.ig_account_id)
      .eq("kind", "dm")
      .eq("author_id", it.author_id)
      .order("received_at", { ascending: true })
      .limit(50);
    thread = (t ?? []) as Row[];
  } else if (it.kind === "comment") {
    const root = it.parent_id ?? it.provider_id;
    const { data: t } = await supabase
      .from("ig_interactions")
      .select(COLS)
      .eq("ig_account_id", it.ig_account_id)
      .or(`provider_id.eq."${root}",parent_id.eq."${root}"`)
      .order("received_at", { ascending: true })
      .limit(50);
    thread = (t ?? []) as Row[];
  }

  return (
    <div className="space-y-4">
      <Link href="/social" className="text-sm text-slate-500 hover:text-brand">← Back to Social</Link>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium capitalize text-slate-700">{it.kind === "dm" ? "Message" : it.kind}</span>
          <span className="capitalize">{it.status}</span>
          <span>· {when(it.created_at_provider ?? it.received_at)}</span>
        </div>
        <p className="mt-2 text-lg font-semibold text-slate-800">{it.author_handle ? `@${it.author_handle}` : "Unknown sender"}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{it.text?.trim() || <span className="italic text-slate-400">(no text)</span>}</p>
        {it.permalink && (
          <a href={it.permalink} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-brand hover:underline">
            View on Instagram ↗
          </a>
        )}
      </div>

      {thread.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{it.kind === "dm" ? "Conversation" : "Thread"}</h2>
          <ol className="space-y-3">
            {thread.map((m) => (
              <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.id === it.id ? "bg-brand/5 ring-1 ring-brand/30" : "bg-slate-50"}`}>
                <p className="text-xs text-slate-500">{m.author_handle ? `@${m.author_handle}` : "—"} · {when(m.created_at_provider ?? m.received_at)}</p>
                <p className="whitespace-pre-wrap break-words text-slate-700">{m.text?.trim() || "(no text)"}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500" id="reply">
        Replying from the CRM arrives in the next update.
      </div>
    </div>
  );
}
