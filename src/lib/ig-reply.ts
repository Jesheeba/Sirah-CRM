/**
 * Pure rules for replies from the social desk (F4): which channels an item allows, Instagram's
 * time windows, body validation and who may approve. No network or DB — unit-tested.
 */

export type ReplyChannel = "public" | "private" | "dm";
export type ReplyMode = "human_approval" | "direct";
export type ReplyStatus = "pending_approval" | "approved" | "sent" | "rejected" | "failed";

export const DM_WINDOW_MS = 24 * 3600_000;
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600_000;
const MAX_LEN: Record<ReplyChannel, number> = { public: 2200, private: 1000, dm: 1000 };

export interface ReplyTarget {
  kind: "comment" | "mention" | "tag" | "dm";
  /** When the comment / message was made (falls back to when we received it). */
  at: string | null;
  /** Mention replies need the post id. */
  mediaId: string | null;
  /** True for a mention that is a caption mention (no comment to reply under). */
  captionMention?: boolean;
}

/** Channels an item can be answered on. Tagged posts and caption mentions have nothing to reply under. */
export function allowedChannels(t: ReplyTarget): ReplyChannel[] {
  if (t.kind === "dm") return ["dm"];
  if (t.kind === "comment") return ["public", "private"];
  if (t.kind === "mention") return t.captionMention || !t.mediaId ? [] : ["public"];
  return [];
}

export type WindowCheck = { ok: true } | { ok: false; reason: string };

/**
 * Instagram's messaging windows. `lastInboundAt` for a DM is the person's latest message;
 * for a private reply it's the comment time, and `alreadyPrivateReplied` blocks a second one.
 */
export function checkWindow(
  channel: ReplyChannel,
  lastInboundAt: string | null,
  now: Date = new Date(),
  alreadyPrivateReplied = false,
): WindowCheck {
  if (channel === "public") return { ok: true };
  const t = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  if (Number.isNaN(t)) return { ok: false, reason: "Can't tell when the message was sent, so Instagram may refuse it." };
  const age = now.getTime() - t;
  if (channel === "dm" && age > DM_WINDOW_MS) {
    return { ok: false, reason: "Instagram only allows a reply within 24 hours of the person's last message." };
  }
  if (channel === "private") {
    if (alreadyPrivateReplied) return { ok: false, reason: "A private reply was already sent for this comment (Instagram allows one)." };
    if (age > PRIVATE_REPLY_WINDOW_MS) return { ok: false, reason: "Private replies are only allowed within 7 days of the comment." };
  }
  return { ok: true };
}

export function validateBody(body: string, channel: ReplyChannel): { ok: true; body: string } | { ok: false; reason: string } {
  const b = body.replace(/\r\n/g, "\n").trim();
  if (!b) return { ok: false, reason: "Write a reply first." };
  if ([...b].length > MAX_LEN[channel]) return { ok: false, reason: `Too long — Instagram allows ${MAX_LEN[channel]} characters here.` };
  return { ok: true, body: b };
}

export interface Actor {
  userId: string;
  isAdmin: boolean;
  isManager: boolean;
}

/** Only Admins/Managers approve; the drafter can't approve their own reply unless the org allows it. */
export function canApprove(actor: Actor, draftedBy: string | null, allowSelfApprove: boolean): WindowCheck {
  if (!actor.isAdmin && !actor.isManager) return { ok: false, reason: "Only admins and managers can approve replies." };
  if (!allowSelfApprove && draftedBy && draftedBy === actor.userId) {
    return { ok: false, reason: "Someone else must approve a reply you wrote." };
  }
  return { ok: true };
}

/** Whether a newly written reply goes straight out or waits for approval. */
export function initialStatus(mode: ReplyMode, actor: Actor): "send_now" | "pending_approval" {
  return mode === "direct" && (actor.isAdmin || actor.isManager) ? "send_now" : "pending_approval";
}
