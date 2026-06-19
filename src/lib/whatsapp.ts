// WhatsApp helpers. Status styling and {{variable}} merging are shared with email
// (see lib/email.ts) since both use the channel-aware `communications` log.

/** Digits-only E.164 form (no '+'), as wa.me and the Cloud API expect. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^\d]/g, "");
}

/** wa.me click-to-chat link — the zero-config send path. */
export function waMeUrl(phone: string, text: string): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text || "")}`;
}
