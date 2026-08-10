import type { CommStatus } from "@/lib/types";

/** Variables a template/compose can interpolate. Extend as records expose more. */
export const TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: "to_name", label: "Recipient name" },
  { key: "first_name", label: "First name" },
  { key: "account", label: "Account name" },
  { key: "owner_name", label: "Your name" },
  { key: "org_name", label: "Organization" },
  { key: "quote_number", label: "Quote number" },
  { key: "quote_total", label: "Quote total" },
  { key: "quote_link", label: "Quote link" },
];

/** Replaces {{key}} tokens with values; unknown tokens are left as-is. */
export function mergeTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  if (!text) return "";
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? m : String(v);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text body → minimal HTML for provider sends (newlines preserved). */
export function bodyToHtml(body: string): string {
  return escapeHtml(body || "").replace(/\n/g, "<br/>");
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/g;

/**
 * Plain-text body → HTML, same as bodyToHtml, but every bare URL becomes a clickable
 * link — optionally rewritten through `wrapUrl` (the click-tracking redirect) first.
 * Used for real provider sends only; bodyToHtml stays as-is for callers that don't
 * need link rewriting (e.g. contexts with no tracking token to attach).
 */
export function bodyToTrackedHtml(body: string, wrapUrl?: (url: string) => string): string {
  if (!body) return "";
  let html = "";
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    const url = m[0];
    const start = m.index ?? 0;
    html += escapeHtml(body.slice(last, start));
    const href = wrapUrl ? wrapUrl(url) : url;
    html += `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
    last = start + url.length;
  }
  html += escapeHtml(body.slice(last));
  return html.replace(/\n/g, "<br/>");
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ subject: subject || "", body: body || "" }).toString();
  return `mailto:${encodeURIComponent(to)}?${q}`;
}

export const COMM_STATUS_STYLE: Record<CommStatus, string> = {
  draft: "bg-slate-100 text-slate-500",
  queued: "bg-slate-100 text-slate-500",
  sent: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  delivered: "bg-indigo-100 text-indigo-700",
  opened: "bg-green-100 text-green-700",
  clicked: "bg-emerald-100 text-emerald-700",
  received: "bg-amber-100 text-amber-700",
};
