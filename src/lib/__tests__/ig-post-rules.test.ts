import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMedia } from "@/lib/ig-graph";
import { mediaIdParam, resolveIgRule, type IgRule } from "@/lib/ig-rules";

// Feature doc: build-docs/features/ig-post-rules.md

afterEach(() => vi.unstubAllGlobals());
const stubFetch = (body: unknown, status = 200) => {
  const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("AC1 fetchMedia maps the account's posts", () => {
  it("uses thumbnail_url for reels, media_url for images, and drops items without an id", async () => {
    const f = stubFetch({
      data: [
        { id: "1", caption: "Pink saree", media_type: "VIDEO", media_url: "https://cdn/v.mp4", thumbnail_url: "https://cdn/t.jpg", permalink: "https://ig/p/1", timestamp: "2026-11-19T10:00:00+0000" },
        { id: "2", media_type: "IMAGE", media_url: "https://cdn/i.jpg" },
        { id: "3", media_type: "VIDEO", media_url: "https://cdn/v3.mp4" },
        { caption: "no id" },
      ],
    });
    const posts = await fetchMedia("17841", "tok");
    expect(posts.map((p) => [p.id, p.thumbnail])).toEqual([["1", "https://cdn/t.jpg"], ["2", "https://cdn/i.jpg"], ["3", null]]);
    expect(posts[0]).toMatchObject({ caption: "Pink saree", mediaType: "VIDEO", permalink: "https://ig/p/1" });
    const url = new URL(f.mock.calls[0][0] as URL);
    expect(url.pathname).toMatch(/\/17841\/media$/);
    expect(url.searchParams.get("fields")).toContain("thumbnail_url");
  });
});

describe("AC2 errors never contain the token", () => {
  it("throws Meta's message only", async () => {
    stubFetch({ error: { message: "Invalid OAuth access token" } }, 400);
    await expect(fetchMedia("17841", "SECRET_TOKEN")).rejects.toThrow("Invalid OAuth access token");
    await expect(fetchMedia("17841", "SECRET_TOKEN")).rejects.not.toThrow(/SECRET_TOKEN/);
  });
});

describe("AC4 ?media= accepts only numeric media ids", () => {
  it.each([
    ["18139220461653363", "18139220461653363"],
    ["abc", null],
    ["123", null],
    ["1813922046165336' or 1=1", null],
    [["18139220461653363"], null],
    [undefined, null],
  ])("%j → %j", (input, out) => expect(mediaIdParam(input)).toBe(out));
});

describe("AC3 a post-specific rule answers only on its post and wins over the general rule", () => {
  const rule = (over: Partial<IgRule>): IgRule => ({
    id: over.name ?? "r", name: "r", ig_account_id: null, applies_to: "comment", ig_media_id: null, rule_type: "keyword",
    match_keywords: ["link"], match_mode: "any", whole_word: true, priority: 100, is_enabled: true,
    action: "both", reply_text: "Check your DM", dm_text: "general", send_mode: "auto", ...over,
  });
  const rules = [rule({ name: "general" }), rule({ name: "saree", ig_media_id: "111", dm_text: "saree link" }), rule({ name: "difai", ig_media_id: "222", dm_text: "difai link" })];
  const ev = (mediaId: string) => ({ kind: "comment" as const, text: "Link", mediaId, igAccountId: "a", isOwn: false });
  it.each([["111", "saree"], ["222", "difai"], ["333", "general"]])("comment on post %s → rule %s", (m, name) => {
    const out = resolveIgRule(ev(m), rules, []);
    expect(out.kind === "match" ? out.rule.name : out.kind).toBe(name);
  });
});
