import { describe, expect, it } from "vitest";
import { formatWhen, parseSocialQuery, socialHref, statusAfterAssign, statusAfterIgnore } from "./social-list";
import { DEFAULT_LABELS, MODULE_KEYS, resolveVisibility, defaultBranding } from "./branding";

describe("F3 inbox URL state", () => {
  it("defaults to page 1, all types, 'needs attention', everyone's items", () => {
    expect(parseSocialQuery({})).toEqual({ page: 1, kind: "", status: "", mine: false, q: "" });
  });
  it("accepts known kinds/statuses and ignores unknown ones", () => {
    expect(parseSocialQuery({ kind: "mention", status: "ignored" })).toMatchObject({ kind: "mention", status: "ignored" });
    expect(parseSocialQuery({ kind: "story;drop", status: "weird" })).toMatchObject({ kind: "", status: "" });
    expect(parseSocialQuery({ status: "all" }).status).toBe("all");
  });
  it("search text is sanitised before it reaches the filter", () => {
    expect(parseSocialQuery({ q: "a,b)or(id.eq.1" }).q).not.toMatch(/[,()]/);
  });
  it("bad page numbers fall back to 1; mine only when 1", () => {
    expect(parseSocialQuery({ page: "-2" }).page).toBe(1);
    expect(parseSocialQuery({ page: "x", mine: "yes" })).toMatchObject({ page: 1, mine: false });
    expect(parseSocialQuery({ mine: "1" }).mine).toBe(true);
  });
  it("links keep only non-default values and survive a round trip", () => {
    const q = parseSocialQuery({});
    expect(socialHref(q)).toBe("/social");
    const href = socialHref(q, { page: 3, kind: "dm", status: "all", mine: true, q: "office" });
    expect(href).toBe("/social?page=3&kind=dm&status=all&mine=1&q=office");
    expect(parseSocialQuery(Object.fromEntries(new URL(href, "https://x").searchParams))).toEqual({
      page: 3, kind: "dm", status: "all", mine: true, q: "office",
    });
  });
});

describe("F3 dates render identically on server and browser", () => {
  it("formats in the organization's zone, not the machine's (prevents hydration error #418)", () => {
    expect(formatWhen("2026-11-18T09:47:00Z", "Asia/Kolkata")).toMatch(/18 Nov.*03:17\s?pm/i);
    expect(formatWhen("2026-11-18T09:47:00Z", "UTC")).toMatch(/18 Nov.*09:47\s?am/i);
  });
  it("includes the year when asked; null/garbage → em dash; unknown zone falls back to IST", () => {
    expect(formatWhen("2026-11-18T09:47:00Z", "Asia/Kolkata", true)).toMatch(/2026/);
    expect(formatWhen(null)).toBe("—");
    expect(formatWhen("nope")).toBe("—");
    expect(formatWhen("2026-11-18T09:47:00Z", "Not/AZone")).toMatch(/03:17\s?pm/i);
  });
});

describe("F3 status rules", () => {
  it("assigning a new item makes it assigned; unassigning puts it back to new", () => {
    expect(statusAfterAssign("new", "u1")).toBe("assigned");
    expect(statusAfterAssign("assigned", null)).toBe("new");
    expect(statusAfterAssign("assigned", "u2")).toBe("assigned");
  });
  it("finished items keep their status when (re)assigned", () => {
    for (const s of ["replied", "issue", "ignored", "deleted"] as const) {
      expect(statusAfterAssign(s, "u1")).toBe(s);
      expect(statusAfterAssign(s, null)).toBe(s);
    }
  });
  it("only open items can be ignored; restoring returns to new or assigned", () => {
    expect(statusAfterIgnore("new", true, null)).toBe("ignored");
    expect(statusAfterIgnore("assigned", true, "u1")).toBe("ignored");
    expect(statusAfterIgnore("replied", true, null)).toBeNull();
    expect(statusAfterIgnore("ignored", false, null)).toBe("new");
    expect(statusAfterIgnore("ignored", false, "u1")).toBe("assigned");
    expect(statusAfterIgnore("new", false, null)).toBeNull();
  });
});

describe("F3 Social module is opt-in", () => {
  it("is hidden by default and for tenants without an override", () => {
    expect(defaultBranding().visibility.social).toBe(false);
    expect(resolveVisibility({}).social).toBe(false);
  });
  it("shows when a tenant switches it on, and can be switched off again", () => {
    expect(resolveVisibility({ social: true }).social).toBe(true);
    expect(resolveVisibility({ social: false }).social).toBe(false);
  });
  it("every other module keeps its old default (visible unless false)", () => {
    const v = resolveVisibility({});
    for (const k of MODULE_KEYS) if (k !== "social") expect(v[k]).toBe(true);
    expect(resolveVisibility({ leads: false }).leads).toBe(false);
    expect(DEFAULT_LABELS.social).toBe("Social");
  });
});
