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

/** Plain-text body → minimal HTML for provider sends (newlines preserved). */
export function bodyToHtml(body: string): string {
  const escaped = (body || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br/>");
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
