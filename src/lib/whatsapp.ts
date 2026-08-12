// WhatsApp helpers. Status styling and {{variable}} merging are shared with email
// (see lib/email.ts) since both use the channel-aware `communications` log.

/** Pinned WhatsApp Cloud API / Business Management API Graph version (one place to bump). */
export const WHATSAPP_GRAPH = "v22.0";

/** Digits-only E.164 form (no '+'), as wa.me and the Cloud API expect. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^\d]/g, "");
}

/** wa.me click-to-chat link — the zero-config send path. */
export function waMeUrl(phone: string, text: string): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text || "")}`;
}

const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "opt out", "optout", "cancel"]);

/** Standard opt-out keywords a recipient might send — checked by both inbound webhooks. */
export function isOptOutMessage(body: string): boolean {
  return OPT_OUT_KEYWORDS.has((body ?? "").trim().toLowerCase());
}
