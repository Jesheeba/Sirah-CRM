import { describe, it, expect } from "vitest";
import {
  buildCsv,
  extractFeedKey,
  feedKeyPrefix,
  generateFeedToken,
  hashFeedKey,
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
    fb_form_name: "Graphic design batch Nov",
    fb_page_id: "333",
    fb_ad_id: "444",
    fb_ad_name: "Nov batch – carousel A",
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

describe("hashFeedKey / feedKeyPrefix", () => {
  it("hashes deterministically to 64 hex chars and never returns the key", () => {
    const key = generateFeedToken();
    const h = hashFeedKey(key);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashFeedKey(key));
    expect(h).not.toContain(key);
    expect(hashFeedKey(key + "x")).not.toBe(h);
  });
  it("matches the SQL used by the migration (sha256 of the UTF-8 text, hex)", () => {
    expect(hashFeedKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("exposes only a short prefix", () => {
    expect(feedKeyPrefix("lf_AbCdEfGhIjKl")).toBe("lf_AbCdE");
  });
});

describe("extractFeedKey", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  const q = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

  it("prefers a Bearer header and reports it came from a header", () => {
    expect(extractFeedKey(h({ authorization: "Bearer lf_abc" }), q({}))).toEqual({ key: "lf_abc", via: "header" });
    expect(extractFeedKey(h({ authorization: "bearer lf_abc" }), q({}))?.key).toBe("lf_abc");
  });
  it("accepts X-API-Key", () => {
    expect(extractFeedKey(h({ "x-api-key": " lf_xyz " }), q({}))).toEqual({ key: "lf_xyz", via: "header" });
  });
  it("falls back to ?token= and flags it as url", () => {
    expect(extractFeedKey(h({}), q({ token: "lf_q" }))).toEqual({ key: "lf_q", via: "url" });
  });
  it("the header wins when both are present", () => {
    expect(extractFeedKey(h({ authorization: "Bearer lf_h" }), q({ token: "lf_q" }))).toEqual({
      key: "lf_h",
      via: "header",
    });
  });
  it("returns null for nothing or a malformed Authorization header", () => {
    expect(extractFeedKey(h({}), q({}))).toBeNull();
    expect(extractFeedKey(h({ authorization: "Basic abc" }), q({}))).toBeNull();
    expect(extractFeedKey(h({ authorization: "Bearer" }), q({}))).toBeNull();
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
      form_name: "Graphic design batch Nov",
      ad_id: "444",
      ad_name: "Nov batch – carousel A",
      answers: { course: "Graphic design" },
    });
  });
  it("tolerates missing custom_fields and unknown pages", () => {
    const lead = toFeedLead(row({ custom_fields: null, first_name: null, last_name: null }), new Map());
    expect(lead.name).toBe("");
    expect(lead.page_name).toBeNull();
    expect(lead.ad_name).toBeNull();
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
      "id,leadgen_id,created_at,submitted_at,name,first_name,last_name,email,phone,company,source,platform,page_id,page_name,form_id,form_name,ad_id,ad_name,answer_city,answer_course",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1].endsWith(",,Graphic design")).toBe(true);
    expect(lines[2].endsWith(",Chennai,")).toBe(true);
    expect(lines[1]).toContain("444,Nov batch");
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
