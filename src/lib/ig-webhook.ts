import crypto from "node:crypto";

/**
 * Pure parsing + signature check for Instagram Login webhooks (feature F2). No network, no DB,
 * so every payload shape is unit-testable. Handles the three fields we subscribe to:
 *   comments  → `entry[].changes[{field:"comments", value:{id,text,from,media,parent_id}}]`
 *   mentions  → `entry[].changes[{field:"mentions", value:{comment_id|media_id, …}}]`
 *   messages  → `entry[].messaging[{sender,recipient,timestamp,message:{mid,text,is_echo}}]`
 *               (and the same object under `changes[{field:"messages"}]`)
 */

export type IgEventKind = "comment" | "mention" | "tag" | "dm";

export interface IgEvent {
  /** The connected account: webhook `entry.id`. */
  igUserId: string;
  kind: IgEventKind;
  providerId: string;
  authorId: string | null;
  authorHandle: string | null;
  text: string | null;
  mediaId: string | null;
  permalink: string | null;
  parentId: string | null;
  occurredAt: string | null;
  /** Mentions arrive as ids only; the ingest step fetches the text with the account token. */
  mention?: { commentId?: string; mediaId?: string };
  raw: unknown;
}

const s = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/** Webhook times are seconds (entry.time) or milliseconds (messaging.timestamp). */
export function toIso(v: unknown): string | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

interface Obj {
  [k: string]: unknown;
}
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

function parseMessage(igUserId: string, m: Obj, fallbackTime: unknown): IgEvent | null {
  const message = obj(m.message);
  const sender = obj(m.sender);
  if (!message || message.is_echo === true) return null; // echoes are our own outbound messages
  const mid = s(message.mid);
  const senderId = s(sender?.id);
  if (!mid || !senderId || senderId === igUserId) return null;
  return {
    igUserId,
    kind: "dm",
    providerId: mid,
    authorId: senderId,
    authorHandle: null,
    text: s(message.text),
    mediaId: null,
    permalink: null,
    parentId: null,
    occurredAt: toIso(m.timestamp ?? fallbackTime),
    raw: m,
  };
}

/** Flatten a webhook body into events. Anything unrecognised is skipped, never thrown on. */
export function parseIgWebhook(body: unknown): IgEvent[] {
  const root = obj(body);
  if (!root || !Array.isArray(root.entry)) return [];
  const out: IgEvent[] = [];

  for (const e of root.entry) {
    const entry = obj(e);
    const igUserId = s(entry?.id);
    if (!entry || !igUserId) continue;

    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const ev = obj(m) && parseMessage(igUserId, m as Obj, entry.time);
      if (ev) out.push(ev);
    }

    for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
      const change = obj(c);
      const value = obj(change?.value);
      if (!change || !value) continue;

      if (change.field === "messages") {
        const ev = parseMessage(igUserId, value, entry.time);
        if (ev) out.push(ev);
      } else if (change.field === "comments") {
        const id = s(value.id);
        if (!id) continue;
        const from = obj(value.from);
        out.push({
          igUserId,
          kind: "comment",
          providerId: id,
          authorId: s(from?.id),
          authorHandle: s(from?.username),
          text: s(value.text),
          mediaId: s(obj(value.media)?.id),
          permalink: null,
          parentId: s(value.parent_id),
          occurredAt: toIso(entry.time),
          raw: value,
        });
      } else if (change.field === "mentions") {
        const commentId = s(value.comment_id);
        const mediaId = s(value.media_id);
        const id = commentId ?? mediaId;
        if (!id) continue;
        out.push({
          igUserId,
          kind: "mention",
          providerId: id,
          authorId: null,
          authorHandle: null,
          text: null,
          mediaId,
          permalink: null,
          parentId: null,
          occurredAt: toIso(entry.time),
          mention: { commentId: commentId ?? undefined, mediaId: mediaId ?? undefined },
          raw: value,
        });
      }
    }
  }
  return out;
}

/** `X-Hub-Signature-256` over the raw body, keyed with the Instagram app secret. */
export function verifyIgSignature(rawBody: string, header: string | null, secret = process.env.IG_APP_SECRET ?? ""): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
