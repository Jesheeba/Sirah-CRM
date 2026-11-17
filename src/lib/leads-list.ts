export const LEADS_PAGE_SIZE = 50;

export type LeadsSort = "newest" | "score_desc" | "score_asc";

export interface LeadsQuery {
  page: number;
  view: "mine" | "all";
  form: string;
  /** Ad name, or the ad id when Meta withheld the name. */
  ad: string;
  sort: LeadsSort;
  q: string;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Strip characters that carry meaning inside a PostgREST `or()` / `ilike` filter. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%*_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function parseLeadsQuery(params: Params, defaultMine: boolean): LeadsQuery {
  const page = Math.floor(Number(first(params.page)));
  const sort = first(params.sort);
  const view = first(params.view);
  return {
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100000) : 1,
    view: view === "mine" || view === "all" ? view : defaultMine ? "mine" : "all",
    form: first(params.form).slice(0, 200),
    ad: first(params.ad).slice(0, 200),
    sort: sort === "score_desc" || sort === "score_asc" ? sort : "newest",
    q: sanitizeSearch(first(params.q)),
  };
}

/** Query string for a link, leaving out values that equal the defaults. */
export function leadsHref(q: LeadsQuery, defaultMine: boolean, over: Partial<LeadsQuery> = {}): string {
  const n = { ...q, ...over };
  const sp = new URLSearchParams();
  if (n.page > 1) sp.set("page", String(n.page));
  if (n.view !== (defaultMine ? "mine" : "all")) sp.set("view", n.view);
  if (n.form) sp.set("form", n.form);
  if (n.ad) sp.set("ad", n.ad);
  if (n.sort !== "newest") sp.set("sort", n.sort);
  if (n.q) sp.set("q", n.q);
  const s = sp.toString();
  return s ? `/leads?${s}` : "/leads";
}
