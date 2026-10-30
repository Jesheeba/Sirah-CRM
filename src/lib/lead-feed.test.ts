import { describe, it, expect } from "vitest";
import {
  buildCsv,
  generateFeedToken,
  parseLimit,
  parseSince,
  toCursor,
  toFeedLead,
  type FeedLeadRow,
} from "./lead-feed";

const row = (over: Partial<FeedLeadRow> = {}): FeedLeadRow => ({
  id: "lead-1",
  first_name: "Asha",
  last_name: "Devi",
  email: "asha@example.com",
  phone: "+919999999999",
  company: null,
  source: "Facebook Lead Ads",
  created_at: "2026-10-26T14:25:02.75087+00:00",
  custom_fields: {
    course: "Graphic design",
    fb_leadgen_id: "111",
    fb_form_id: "222",
    fb_page_id: "333",
    fb_ad_id: "444",
    fb_platform: "fb",
    fb_created_time: "2026-08-14T09:30:00+0000",
  },
  ...over,
});

describe("generateFeedToken", () => {
  it("is prefixed, URL-safe and unique", () => {
    const a = generateFeedToken();
    const b = generateFeedToken();
    expect(a).toMatch(/^lf_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("parseLimit", () => {
  it("defaults on missing or junk input", () => {
    expect(parseLimit(null)).toBe(500);
    expect(parseLimit("abc")).toBe(500);
    expect(parseLimit("0")).toBe(500);
    expect(parseLimit("-5")).toBe(500);
  });
  it("clamps to the maximum", () => {
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("999999")).toBe(1000);
  });
});

describe("parseSince / toCursor", () => {
  it("returns null when absent and undefined when invalid", () => {
    expect(parseSince(null)).toBeNull();
    expect(parseSince("  ")).toBeNull();
    expect(parseSince("not-a-date")).toBeUndefined();
  });
  it("keeps microsecond precision so a cursor never re-returns its own lead", () => {
    const cursor = toCursor("2026-10-26T14:25:02.75087+00:00");
    expect(cursor).toBe("2026-10-26T14:25:02.75087Z");
    expect(parseSince(cursor)).toBe("2026-10-26T14:25:02.75087Z");
  });
});

describe("toFeedLead", () => {
  it("flattens routing metadata and keeps only form answers in `answers`", () => {
    const lead = toFeedLead(row(), new Map([["333", "RD Interlock Bricks"]]));
    expect(lead).toMatchObject({
      id: "lead-1",
      leadgen_id: "111",
      submitted_at: "2026-08-14T09:30:00.000Z",
      name: "Asha Devi",
      platform: "fb",
      page_id: "333",
      page_name: "RD Interlock Bricks",
      form_id: "222",
      ad_id: "444",
      answers: { course: "Graphic design" },
    });
  });
  it("tolerates missing custom_fields and unknown pages", () => {
    const lead = toFeedLead(row({ custom_fields: null, first_name: null, last_name: null }), new Map());
    expect(lead.name).toBe("");
    expect(lead.page_name).toBeNull();
    expect(lead.answers).toEqual({});
    expect(lead.submitted_at).toBeNull();
  });
});

describe("buildCsv", () => {
  it("emits base columns plus one column per distinct answer key", () => {
    const a = toFeedLead(row(), new Map());
    const b = toFeedLead(
      row({ id: "lead-2", custom_fields: { city: "Chennai", fb_leadgen_id: "112" } }),
      new Map(),
    );
    const lines = buildCsv([a, b]).trim().split("\r\n");
    expect(lines[0]).toBe(
      "id,leadgen_id,created_at,submitted_at,name,first_name,last_name,email,phone,company,source,platform,page_id,page_name,form_id,ad_id,answer_city,answer_course",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1].endsWith(",,Graphic design")).toBe(true);
    expect(lines[2].endsWith(",Chennai,")).toBe(true);
  });

  it("never duplicates a base column header when a form question shares its name", () => {
    const l = toFeedLead(row({ custom_fields: { phone: "123", fb_leadgen_id: "1" } }), new Map());
    const header = buildCsv([l]).split("\r\n")[0].split(",");
    expect(new Set(header).size).toBe(header.length);
    expect(header).toContain("answer_phone");
  });

  it("quotes commas, quotes and newlines", () => {
    const l = toFeedLead(row({ custom_fields: { note: 'say "hi", ok\nbye', fb_leadgen_id: "1" } }), new Map());
    expect(buildCsv([l])).toContain('"say ""hi"", ok\nbye"');
  });

  it("neutralises spreadsheet formula injection", () => {
    const l = toFeedLead(
      row({ first_name: "=HYPERLINK(\"http://evil\")", custom_fields: { note: "+1+1", fb_leadgen_id: "1" } }),
      new Map(),
    );
    const csv = buildCsv([l]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",'+1+1");
  });
});
