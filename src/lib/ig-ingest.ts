import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMention, fetchSenderHandle, fetchTags, type EnrichFn } from "@/lib/ig-graph";
import { notifyIgMentions } from "@/lib/ig-notify";
import type { IgEvent } from "@/lib/ig-webhook";

export interface IngestResult {
  stored: number;
  duplicate: number;
  ignored: number;
  unknownAccount: number;
  /** Newly stored, answerable items (not the account's own) — input for keyword rules. */
  created: CreatedInteraction[];
}

export interface CreatedInteraction {
  id: string;
  tenant_id: string;
  ig_account_id: string;
  kind: IgEvent["kind"];
  provider_id: string;
  author_id: string | null;
  author_handle?: string | null;
  text: string | null;
  media_id: string | null;
  created_at_provider: string | null;
  received_at: string;
}

interface Account {
  id: string;
  tenant_id: string;
  ig_user_id: string;
  access_token: string;
}

/**
 * Stores parsed Instagram events (F2). Idempotent on (account, provider id): a retried
 * delivery changes nothing. Events for an account we don't hold (or one that was
 * disconnected) are dropped. The account's OWN comments are kept as `ignored` so the desk
 * can never reply to itself. Mentions arrive as bare ids, so the text is fetched with the
 * account's token — a failed lookup still stores the mention (without text) rather than losing it.
 */
export async function ingestIgEvents(
  admin: SupabaseClient,
  events: IgEvent[],
  deps: { enrich?: EnrichFn; senderHandle?: (igsid: string, token: string) => Promise<string | null> } = {},
): Promise<IngestResult> {
  const enrich = deps.enrich ?? fetchMention;
  const senderHandle = deps.senderHandle ?? fetchSenderHandle;
  const out: IngestResult = { stored: 0, duplicate: 0, ignored: 0, unknownAccount: 0, created: [] };
  const accounts = new Map<string, Account | null>();

  const byAccount = new Map<string, IgEvent[]>();
  for (const ev of events) byAccount.set(ev.igUserId, [...(byAccount.get(ev.igUserId) ?? []), ev]);

  for (const [igUserId, evs] of byAccount) {
    if (!accounts.has(igUserId)) {
      const { data } = await admin
        .from("ig_accounts")
        .select("id, tenant_id, ig_user_id, access_token")
        .eq("ig_user_id", igUserId)
        .eq("status", "active")
        .maybeSingle();
      accounts.set(igUserId, (data as Account | null) ?? null);
    }
    const acc = accounts.get(igUserId);
    if (!acc) {
      out.unknownAccount += evs.length;
      continue;
    }

    const ids = [...new Set(evs.map((e) => e.providerId))];
    const { data: existing } = await admin
      .from("ig_interactions")
      .select("provider_id")
      .eq("ig_account_id", acc.id)
      .in("provider_id", ids);
    const seen = new Set(((existing ?? []) as { provider_id: string }[]).map((r) => r.provider_id));

    for (const ev of evs) {
      if (seen.has(ev.providerId)) {
        out.duplicate++;
        continue;
      }
      seen.add(ev.providerId); // duplicates inside one delivery

      let { text, authorHandle, mediaId, permalink, occurredAt } = ev;
      if (ev.mention && acc.access_token) {
        const info = await enrich(acc.ig_user_id, ev.mention, acc.access_token).catch(() => null);
        if (info) {
          text = info.text ?? text;
          authorHandle = info.authorHandle ?? authorHandle;
          mediaId = info.mediaId ?? mediaId;
          permalink = info.permalink ?? permalink;
          occurredAt = info.occurredAt ?? occurredAt;
        }
      }
      // DM webhooks carry only the sender id; look up the @username so staff (and reviewers) see who wrote.
      if (ev.kind === "dm" && !authorHandle && ev.authorId && ev.authorId !== acc.ig_user_id && acc.access_token) {
        authorHandle = await senderHandle(ev.authorId, acc.access_token).catch(() => null);
      }

      const own = ev.authorId === acc.ig_user_id;
      const receivedAt = new Date().toISOString();
      const { data: inserted, error } = await admin.from("ig_interactions").insert({
        tenant_id: acc.tenant_id,
        ig_account_id: acc.id,
        kind: ev.kind,
        provider_id: ev.providerId,
        author_id: ev.authorId,
        author_handle: authorHandle,
        text,
        media_id: mediaId,
        permalink,
        parent_id: ev.parentId,
        created_at_provider: occurredAt,
        status: own ? "ignored" : "new",
        received_at: receivedAt,
        raw: ev.raw,
      }).select("id");
      if (error) {
        if ((error as { code?: string }).code === "23505") out.duplicate++; // lost a race to a parallel delivery
        continue;
      }
      if (own) {
        out.ignored++;
        continue;
      }
      out.stored++;
      const id = ((inserted ?? []) as { id: string }[])[0]?.id;
      if (id) {
        out.created.push({
          id, tenant_id: acc.tenant_id, ig_account_id: acc.id, kind: ev.kind, provider_id: ev.providerId,
          author_id: ev.authorId, author_handle: authorHandle, text, media_id: mediaId, created_at_provider: occurredAt, received_at: receivedAt,
        });
      }
    }
  }
  await notifyIgMentions(admin, out.created).catch(() => 0);
  return out;
}

export interface TagsPollResult {
  accounts: number;
  stored: number;
  failed: number;
}

const MAX_TAG_PAGES = 1; // newest 25 per run; older tags are already known after the first poll

/**
 * Tagged posts have no webhook, so the daily tick (and the inbox's refresh button) polls
 * `/{ig-user-id}/tags` and feeds new ones through the same idempotent ingest.
 */
export async function pollIgTags(
  admin: SupabaseClient,
  deps: { fetch?: typeof fetchTags; accountId?: string; tenantId?: string } = {},
): Promise<TagsPollResult> {
  const doFetch = deps.fetch ?? fetchTags;
  const out: TagsPollResult = { accounts: 0, stored: 0, failed: 0 };

  let q = admin.from("ig_accounts").select("id, tenant_id, ig_user_id, access_token").eq("status", "active");
  if (deps.tenantId) q = q.eq("tenant_id", deps.tenantId);
  if (deps.accountId) q = q.eq("id", deps.accountId);
  const { data } = await q;

  for (const acc of (data ?? []) as Account[]) {
    out.accounts++;
    try {
      for (let page = 0; page < MAX_TAG_PAGES; page++) {
        const posts = await doFetch(acc.ig_user_id, acc.access_token);
        const events: IgEvent[] = posts.map((p) => ({
          igUserId: acc.ig_user_id,
          kind: "tag",
          providerId: p.id,
          authorId: null,
          authorHandle: p.username,
          text: p.caption,
          mediaId: p.id,
          permalink: p.permalink,
          parentId: null,
          occurredAt: p.timestamp ? new Date(p.timestamp).toISOString() : null,
          raw: p,
        }));
        const r = await ingestIgEvents(admin, events);
        out.stored += r.stored;
        if (r.duplicate > 0 || posts.length === 0) break;
      }
    } catch {
      out.failed++;
    }
  }
  return out;
}
