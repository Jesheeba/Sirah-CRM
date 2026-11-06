import { describe, expect, it } from "vitest";
import { distinctAdIds, mergedCustomFields, type BackfillLeadRow } from "./ad-name-backfill";

const row = (id: string, cf: Record<string, unknown> | null): BackfillLeadRow => ({
  id,
  custom_fields: cf,
});

describe("distinctAdIds", () => {
  it("returns one entry per distinct ad, not per lead (AC4)", () => {
    const rows = [
      row("1", { fb_ad_id: "A" }),
      row("2", { fb_ad_id: "A" }),
      row("3", { fb_ad_id: "B" }),
    ];
    expect(distinctAdIds(rows).sort()).toEqual(["A", "B"]);
  });
  it("skips leads that already have a name, so re-running is cheap (AC6)", () => {
    const rows = [row("1", { fb_ad_id: "A", fb_ad_name: "Carousel A" }), row("2", { fb_ad_id: "B" })];
    expect(distinctAdIds(rows)).toEqual(["B"]);
  });
  it("skips leads with no ad id at all", () => {
    expect(distinctAdIds([row("1", { fb_page_id: "P" }), row("2", null)])).toEqual([]);
  });
  it("ignores a blank ad id", () => {
    expect(distinctAdIds([row("1", { fb_ad_id: "" })])).toEqual([]);
  });
});

describe("mergedCustomFields", () => {
  const names = new Map([["A", "Nov batch carousel A"]]);

  it("writes the name while preserving every other field (AC2)", () => {
    const out = mergedCustomFields(
      row("1", { course: "Graphic design", fb_ad_id: "A", fb_page_id: "P", fb_leadgen_id: "L" }),
      names,
    );
    expect(out).toEqual({
      course: "Graphic design",
      fb_ad_id: "A",
      fb_page_id: "P",
      fb_leadgen_id: "L",
      fb_ad_name: "Nov batch carousel A",
    });
  });
  it("returns null when Meta refused the ad, so nothing is written (AC3)", () => {
    expect(mergedCustomFields(row("1", { fb_ad_id: "UNRESOLVED" }), names)).toBeNull();
  });
  it("returns null for a lead that already has a name (AC6)", () => {
    expect(mergedCustomFields(row("1", { fb_ad_id: "A", fb_ad_name: "Existing" }), names)).toBeNull();
  });
  it("returns null for a lead with no ad id", () => {
    expect(mergedCustomFields(row("1", { fb_page_id: "P" }), names)).toBeNull();
    expect(mergedCustomFields(row("2", null), names)).toBeNull();
  });
  it("never mutates the row it was given", () => {
    const cf = { fb_ad_id: "A" };
    mergedCustomFields(row("1", cf), names);
    expect(cf).toEqual({ fb_ad_id: "A" });
  });
});
