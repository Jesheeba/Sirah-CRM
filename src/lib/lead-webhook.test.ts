import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  normalizeLeadPhone,
  parseWebhookLead,
  signWebhook,
  timestampFresh,
  toLeadRecord,
  verifyWebhookSignature,
  type ParsedWebhookLead,
} from "./lead-webhook";

const body = Buffer.from('{"leadId":"1","fullName":"Test"}');

describe("signature (contract section 2)", () => {
  it("matches the documented test vector computed independently", () => {
    // openssl dgst -sha256 -hmac "test-secret" over `1762070400.{"leadId":"1","fullName":"Test"}`
    const independent = createHmac("sha256", "test-secret")
      .update('1762070400.{"leadId":"1","fullName":"Test"}')
      .digest("hex");
    expect(signWebhook("test-secret", "1762070400", body)).toBe(`sha256=${independent}`);
  });

  it("verifies a correct signature and rejects every kind of wrong one", () => {
    const sig = signWebhook("s3cret", "1762070400", body);
    expect(verifyWebhookSignature("s3cret", "1762070400", sig, body)).toBe(true);
    expect(verifyWebhookSignature("wrong", "1762070400", sig, body)).toBe(false); // wrong secret
    expect(verifyWebhookSignature("s3cret", "1762070401", sig, body)).toBe(false); // timestamp is signed
    expect(verifyWebhookSignature("s3cret", "1762070400", sig, Buffer.from('{"leadId":"2"}'))).toBe(false); // body
    expect(verifyWebhookSignature("s3cret", "1762070400", sig.replace("sha256=", ""), body)).toBe(false); // no prefix
    expect(verifyWebhookSignature("s3cret", "1762070400", "sha256=abc", body)).toBe(false); // short
    expect(verifyWebhookSignature("s3cret", "1762070400", null, body)).toBe(false);
    expect(verifyWebhookSignature("s3cret", null, sig, body)).toBe(false);
    expect(verifyWebhookSignature("s3cret", "not-a-number", sig, body)).toBe(false);
    expect(verifyWebhookSignature("", "1762070400", sig, body)).toBe(false); // fail closed on empty secret
  });

  it("accepts an upper-case hex digest (we compare bytes, not text)", () => {
    const sig = signWebhook("k", "1", body);
    const upper = "sha256=" + sig.slice(7).toUpperCase();
    expect(verifyWebhookSignature("k", "1", upper, body)).toBe(true);
  });

  it("signs the exact bytes, including non-ASCII", () => {
    const utf = Buffer.from('{"fullName":"முருகன்"}', "utf8");
    const sig = signWebhook("k", "5", utf);
    expect(verifyWebhookSignature("k", "5", sig, utf)).toBe(true);
    expect(verifyWebhookSignature("k", "5", sig, Buffer.from('{"fullName":"x"}'))).toBe(false);
  });
});

describe("timestampFresh", () => {
  it("allows ±5 minutes either way and nothing beyond", () => {
    expect(timestampFresh("1000", 1000)).toBe(true);
    expect(timestampFresh("1000", 1300)).toBe(true);
    expect(timestampFresh("1000", 700)).toBe(true);
    expect(timestampFresh("1000", 1301)).toBe(false);
    expect(timestampFresh("1000", 699)).toBe(false);
  });
});

describe("normalizeLeadPhone", () => {
  it("normalises the formats named in the contract to the same number", () => {
    expect(normalizeLeadPhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeLeadPhone("09876543210")).toBe("+919876543210");
    expect(normalizeLeadPhone("9876543210")).toBe("+919876543210");
    expect(normalizeLeadPhone("(+91) 98765-43210")).toBe("+919876543210");
    expect(normalizeLeadPhone("919876543210")).toBe("+919876543210");
    expect(normalizeLeadPhone("0091 98765 43210")).toBe("+919876543210");
  });
  it("keeps other countries' explicit prefix", () => {
    expect(normalizeLeadPhone("+1 415 555 0132")).toBe("+14155550132");
  });
  it("returns null when it isn't a usable number", () => {
    expect(normalizeLeadPhone("12345")).toBeNull();
    expect(normalizeLeadPhone("call me")).toBeNull();
    expect(normalizeLeadPhone("1234567890123456")).toBeNull();
  });
});

describe("parseWebhookLead", () => {
  const ok = (r: ReturnType<typeof parseWebhookLead>): ParsedWebhookLead => {
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    return r.lead;
  };

  it("maps the contract's example payload", () => {
    const l = ok(
      parseWebhookLead({
        leadId: "1234567890123456",
        submittedAt: "2026-11-02T09:14:22Z",
        fullName: "Murugan S",
        phoneNumber: "+919876543210",
        city: "Salem",
        typeOfBricks: "8 inch",
        typeOfConstruction: "compound wall",
        numberOfBricks: 4000,
        notes: "Wants delivery before Pongal",
        campaignId: "23859001",
        adsetId: "23859002",
        adId: "23859003",
        formId: "10223",
        platform: "instagram",
      }),
    );
    expect(l).toMatchObject({
      externalId: "1234567890123456",
      submittedAt: "2026-11-02T09:14:22.000Z",
      fullName: "Murugan S",
      phone: "+919876543210",
      city: "Salem",
      numberOfBricks: "4000",
      adsetId: "23859002",
      platform: "instagram",
      missingFields: [],
      extras: {},
    });
  });

  it("requires only leadId and phoneNumber", () => {
    const l = ok(parseWebhookLead({ leadId: "9", phone: "9876543210" }));
    expect(l.missingFields).toEqual(["fullName", "city", "typeOfBricks", "typeOfConstruction", "numberOfBricks"]);

    const noPhone = parseWebhookLead({ leadId: "9", fullName: "X" });
    expect(noPhone).toMatchObject({ ok: false, code: "missing_phone" });
    const noId = parseWebhookLead({ phoneNumber: "9876543210" });
    expect(noId).toMatchObject({ ok: false, code: "missing_lead_id" });
    // an unusable number counts as no number
    expect(parseWebhookLead({ leadId: "9", phoneNumber: "abc" })).toMatchObject({ ok: false, code: "missing_phone" });
  });

  it("matches field names case-insensitively and ignoring separators", () => {
    for (const key of ["fullName", "full_name", "Full Name", "FULLNAME", "full-name"]) {
      expect(ok(parseWebhookLead({ leadId: "1", phone: "9876543210", [key]: "Asha" })).fullName).toBe("Asha");
    }
    const l = ok(
      parseWebhookLead({
        lead_id: "1",
        Mobile: "9876543210",
        place: "Attur",
        brick_size: "9 inch",
        work_type: "house",
        qty: "1,500",
        remarks: "call after 5",
      }),
    );
    expect(l).toMatchObject({
      phone: "+919876543210",
      city: "Attur",
      typeOfBricks: "9 inch",
      typeOfConstruction: "house",
      numberOfBricks: "1500",
      notes: "call after 5",
    });
  });

  it("treats placeholder text as 'not sent' instead of storing it", () => {
    const l = ok(parseWebhookLead({ leadId: "1", phone: "9876543210", city: "N/A", fullName: "null", notes: "  " }));
    expect(l.city).toBeNull();
    expect(l.fullName).toBeNull();
    expect(l.notes).toBeNull();
    expect(l.missingFields).toContain("city");
  });

  it("keeps unknown fields verbatim and defuses reserved/unsafe keys", () => {
    const hostile = JSON.parse('{"leadId":"1","phone":"9876543210","__proto__":{"x":1},"constructor":"c"}');
    const l = ok(
      parseWebhookLead({
        ...hostile,
        budget: "2 lakh",
        fb_leadgen_id: "SPOOF",
        "when to start": 7,
      }),
    );
    expect(l.extras).toEqual({ budget: "2 lakh", x_fb_leadgen_id: "SPOOF", "when to start": "7" });
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // no prototype pollution
  });

  it("caps extra fields and value length", () => {
    const many: Record<string, unknown> = { leadId: "1", phone: "9876543210" };
    for (let i = 0; i < 80; i++) many[`q${i}`] = "v";
    expect(Object.keys(ok(parseWebhookLead(many)).extras)).toHaveLength(50);
    expect(ok(parseWebhookLead({ leadId: "1", phone: "9876543210", essay: "a".repeat(5000) })).extras.essay).toHaveLength(2000);
  });

  it("ignores an unparseable submittedAt instead of rejecting the lead", () => {
    expect(ok(parseWebhookLead({ leadId: "1", phone: "9876543210", submittedAt: "yesterday-ish" })).submittedAt).toBeNull();
  });

  it("prefers the earlier alias when several are sent", () => {
    expect(ok(parseWebhookLead({ leadId: "1", phone: "9876543210", name: "B", fullName: "A" })).fullName).toBe("A");
  });
});

describe("toLeadRecord", () => {
  const rec = (o: Record<string, unknown>) => {
    const r = parseWebhookLead({ leadId: "777", phone: "9876543210", ...o });
    if (!r.ok) throw new Error(r.code);
    return toLeadRecord(r.lead);
  };

  it("splits the name, tags the source and uses the same fb_* keys as Meta leads", () => {
    const r = rec({ fullName: "Murugan S Kumar", city: "Salem", numberOfBricks: 4000, platform: "facebook", adId: "A1", submittedAt: "2026-11-02T09:14:22Z" });
    expect(r).toMatchObject({
      first_name: "Murugan",
      last_name: "S Kumar",
      phone: "+919876543210",
      source: "Facebook Lead Ads",
    });
    expect(r.custom_fields).toMatchObject({
      city: "Salem",
      number_of_bricks: "4000",
      fb_leadgen_id: "777",
      fb_platform: "fb",
      fb_ad_id: "A1",
      fb_created_time: "2026-11-02T09:14:22.000Z",
    });
  });

  it("marks Instagram submissions", () => {
    const r = rec({ platform: "instagram" });
    expect(r.source).toBe("Instagram Lead Ads");
    expect(r.custom_fields.fb_platform).toBe("ig");
  });

  it("never lets an extra field overwrite routing metadata", () => {
    const r = rec({ fb_leadgen_id: "SPOOF", fb_platform: "x" });
    expect(r.custom_fields.fb_leadgen_id).toBe("777");
    expect(r.custom_fields.x_fb_leadgen_id).toBe("SPOOF");
  });
});
