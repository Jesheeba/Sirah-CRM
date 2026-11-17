import { describe, expect, it } from "vitest";
import { leadsHref, parseLeadsQuery, sanitizeSearch } from "./leads-list";

describe("parseLeadsQuery", () => {
  it("defaults: page 1, newest, 'all' for admins and 'mine' for reps", () => {
    expect(parseLeadsQuery({}, false)).toEqual({ page: 1, view: "all", form: "", ad: "", sort: "newest", q: "" });
    expect(parseLeadsQuery({}, true).view).toBe("mine");
  });
  it("an explicit view wins over the default", () => {
    expect(parseLeadsQuery({ view: "all" }, true).view).toBe("all");
  });
  it("bad page numbers fall back to 1", () => {
    for (const page of ["0", "-3", "abc", "NaN", "1.5e400"]) {
      expect(parseLeadsQuery({ page }, false).page).toBeGreaterThanOrEqual(1);
    }
    expect(parseLeadsQuery({ page: "abc" }, false).page).toBe(1);
    expect(parseLeadsQuery({ page: "3" }, false).page).toBe(3);
  });
  it("unknown sort values are ignored", () => {
    expect(parseLeadsQuery({ sort: "created_at;drop" }, false).sort).toBe("newest");
    expect(parseLeadsQuery({ sort: "score_asc" }, false).sort).toBe("score_asc");
  });
});

describe("sanitizeSearch", () => {
  it("removes characters that could change a PostgREST filter", () => {
    expect(sanitizeSearch("a,b)or(id.eq.1")).not.toMatch(/[,()]/);
    expect(sanitizeSearch("50% off_deal*")).toBe("50 off deal");
  });
  it("trims and caps the length", () => {
    expect(sanitizeSearch("   asha   devi  ")).toBe("asha devi");
    expect(sanitizeSearch("x".repeat(500)).length).toBe(80);
  });
});

describe("leadsHref", () => {
  const q = parseLeadsQuery({}, false);
  it("is the bare path when everything is default", () => {
    expect(leadsHref(q, false)).toBe("/leads");
  });
  it("keeps only non-default values", () => {
    expect(leadsHref(q, false, { page: 2, q: "asha", sort: "score_desc" })).toBe("/leads?page=2&sort=score_desc&q=asha");
  });
  it("carries the ad filter and resets to page 1 when it is chosen", () => {
    expect(leadsHref(q, false, { ad: "Summer promo" })).toBe("/leads?ad=Summer+promo");
  });
  it("a rep's default 'mine' is omitted but 'all' is kept", () => {
    const rep = parseLeadsQuery({}, true);
    expect(leadsHref(rep, true)).toBe("/leads");
    expect(leadsHref(rep, true, { view: "all" })).toBe("/leads?view=all");
  });
});
