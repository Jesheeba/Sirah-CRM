import { sanitizeSearch } from "@/lib/leads-list";

/** URL state + status rules for the Instagram social inbox (MLA desk F3). Pure, unit-tested. */

export const SOCIAL_PAGE_SIZE = 50;
export const SOCIAL_KINDS = ["comment", "mention", "tag", "dm"] as const;
export const SOCIAL_STATUSES = ["new", "assigned", "replied", "ignored", "issue", "deleted"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

export interface SocialQuery {
  page: number;
  kind: SocialKind | "";
  /** "" = everything that still needs attention (new + assigned); "all" = no status filter. */
  status: SocialStatus | "" | "all";
  mine: boolean;
  q: string;
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(v: string, list: readonly T[]): T | "" => ((list as readonly string[]).includes(v) ? (v as T) : "");

export function parseSocialQuery(params: Params): SocialQuery {
  const page = Math.floor(Number(first(params.page)));
  const status = first(params.status);
  return {
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100000) : 1,
    kind: oneOf(first(params.kind), SOCIAL_KINDS),
    status: status === "all" ? "all" : oneOf(status, SOCIAL_STATUSES),
    mine: first(params.mine) === "1",
    q: sanitizeSearch(first(params.q)),
  };
}

export function socialHref(q: SocialQuery, over: Partial<SocialQuery> = {}): string {
  const n = { ...q, ...over };
  const sp = new URLSearchParams();
  if (n.page > 1) sp.set("page", String(n.page));
  if (n.kind) sp.set("kind", n.kind);
  if (n.status) sp.set("status", n.status);
  if (n.mine) sp.set("mine", "1");
  if (n.q) sp.set("q", n.q);
  const s = sp.toString();
  return s ? `/social?${s}` : "/social";
}

/** Date + time in the organization's time zone. Explicit zone so the server (UTC) and the
 *  browser render the same text — otherwise React hydration fails and the page's buttons stop working. */
export function formatWhen(iso: string | null, timeZone = "Asia/Kolkata", withYear = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone };
  if (withYear) opts.year = "numeric";
  try {
    return d.toLocaleString("en-IN", opts);
  } catch {
    return d.toLocaleString("en-IN", { ...opts, timeZone: "Asia/Kolkata" }); // unknown zone name
  }
}

/** Status after (un)assigning: assigning a new item makes it `assigned`; un-assigning puts it back to `new`.
 *  Finished states (replied / issue / ignored / deleted) keep their status. */
export function statusAfterAssign(current: SocialStatus, assignee: string | null): SocialStatus {
  if (assignee && current === "new") return "assigned";
  if (!assignee && current === "assigned") return "new";
  return current;
}

/** Ignoring is allowed while an item is open; restoring brings it back as new/assigned. */
export function statusAfterIgnore(current: SocialStatus, ignore: boolean, assignee: string | null): SocialStatus | null {
  if (ignore) return current === "new" || current === "assigned" ? "ignored" : null;
  return current === "ignored" ? (assignee ? "assigned" : "new") : null;
}
