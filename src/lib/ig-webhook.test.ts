import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { parseIgWebhook, toIso, verifyIgSignature } from "./ig-webhook";

const body = (entry: unknown) => ({ object: "instagram", entry: [entry] });

describe("F2 parse: comments", () => {
  it("turns a comments change into a typed comment event", () => {
    const [e] = parseIgWebhook(
      body({
        id: "ig-1",
        time: 1_763_424_000,
        changes: [{ field: "comments", value: { id: "c1", text: "Where is the office?", from: { id: "u9", username: "citizen_a" }, media: { id: "m1" }, parent_id: "c0" } }],
      }),
    );
    expect(e).toMatchObject({
      igUserId: "ig-1", kind: "comment", providerId: "c1", authorId: "u9", authorHandle: "citizen_a",
      text: "Where is the office?", mediaId: "m1", parentId: "c0", occurredAt: "2025-11-18T00:00:00.000Z",
    });
  });
  it("skips a comment with no id", () => {
    expect(parseIgWebhook(body({ id: "ig-1", changes: [{ field: "comments", value: { text: "x" } }] }))).toEqual([]);
  });
});

describe("F2 parse: mentions", () => {
  it("a comment mention carries the comment id and asks for enrichment", () => {
    const [e] = parseIgWebhook(body({ id: "ig-1", time: 1, changes: [{ field: "mentions", value: { comment_id: "mc1", media_id: "mm1" } }] }));
    expect(e).toMatchObject({ kind: "mention", providerId: "mc1", text: null, mention: { commentId: "mc1", mediaId: "mm1" } });
  });
  it("a caption mention is keyed on the media id", () => {
    const [e] = parseIgWebhook(body({ id: "ig-1", changes: [{ field: "mentions", value: { media_id: "mm2" } }] }));
    expect(e).toMatchObject({ kind: "mention", providerId: "mm2", mention: { mediaId: "mm2" } });
    expect(e.mention?.commentId).toBeUndefined();
  });
  it("skips a mention with neither id", () => {
    expect(parseIgWebhook(body({ id: "ig-1", changes: [{ field: "mentions", value: {} }] }))).toEqual([]);
  });
});

describe("F2 parse: direct messages", () => {
  const msg = (over: Record<string, unknown> = {}) => ({
    sender: { id: "u9" }, recipient: { id: "ig-1" }, timestamp: 1_763_424_000_000,
    message: { mid: "mid1", text: "Hello", ...over },
  });
  it("reads the messaging[] shape", () => {
    const [e] = parseIgWebhook(body({ id: "ig-1", messaging: [msg()] }));
    expect(e).toMatchObject({ kind: "dm", providerId: "mid1", authorId: "u9", text: "Hello", occurredAt: "2025-11-18T00:00:00.000Z" });
  });
  it("reads the changes[field=messages] shape too", () => {
    const [e] = parseIgWebhook(body({ id: "ig-1", changes: [{ field: "messages", value: msg() }] }));
    expect(e).toMatchObject({ kind: "dm", providerId: "mid1" });
  });
  it("never stores echoes (our own outbound) or messages sent by the account itself", () => {
    expect(parseIgWebhook(body({ id: "ig-1", messaging: [msg({ is_echo: true })] }))).toEqual([]);
    expect(parseIgWebhook(body({ id: "ig-1", messaging: [{ ...msg(), sender: { id: "ig-1" } }] }))).toEqual([]);
  });
  it("skips a message with no mid", () => {
    expect(parseIgWebhook(body({ id: "ig-1", messaging: [msg({ mid: undefined })] }))).toEqual([]);
  });
});

describe("F2 parse: hostile or odd payloads never throw", () => {
  it.each([null, undefined, 5, "x", [], {}, { entry: "no" }, { entry: [null, 1, "x", {}] }, { entry: [{ id: "i", changes: "x", messaging: 7 }] }])(
    "%j → []",
    (b) => expect(parseIgWebhook(b)).toEqual([]),
  );
  it("handles several events from several accounts in one delivery", () => {
    const evs = parseIgWebhook({
      entry: [
        { id: "a", changes: [{ field: "comments", value: { id: "1" } }, { field: "comments", value: { id: "2" } }] },
        { id: "b", changes: [{ field: "comments", value: { id: "3" } }] },
      ],
    });
    expect(evs.map((e) => `${e.igUserId}:${e.providerId}`)).toEqual(["a:1", "a:2", "b:3"]);
  });
  it("keeps emoji, Tamil and very long text as-is", () => {
    const text = "நன்றி 🙏 " + "x".repeat(3000);
    const [e] = parseIgWebhook(body({ id: "a", changes: [{ field: "comments", value: { id: "1", text } }] }));
    expect(e.text).toBe(text);
  });
});

describe("toIso", () => {
  it("accepts seconds, milliseconds, numeric strings and ISO strings", () => {
    expect(toIso(1_763_424_000)).toBe("2025-11-18T00:00:00.000Z");
    expect(toIso(1_763_424_000_000)).toBe("2025-11-18T00:00:00.000Z");
    expect(toIso("1763424000")).toBe("2025-11-18T00:00:00.000Z");
    expect(toIso("2026-11-18T05:30:00+0530")).toBe("2026-11-18T00:00:00.000Z");
  });
  it("returns null for junk", () => {
    for (const v of [null, undefined, 0, -5, "nope", {}, NaN]) expect(toIso(v)).toBeNull();
  });
});

describe("F2 signature", () => {
  const secret = "ig-secret";
  const raw = '{"entry":[]}';
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  it("accepts the correct signature", () => expect(verifyIgSignature(raw, sig, secret)).toBe(true));
  it("rejects tampered body, wrong secret, missing/odd header and an unset secret", () => {
    expect(verifyIgSignature(raw + " ", sig, secret)).toBe(false);
    expect(verifyIgSignature(raw, sig, "other")).toBe(false);
    expect(verifyIgSignature(raw, null, secret)).toBe(false);
    expect(verifyIgSignature(raw, "sha256=short", secret)).toBe(false);
    expect(verifyIgSignature(raw, sig.replace("sha256=", ""), secret)).toBe(false);
    expect(verifyIgSignature(raw, sig, "")).toBe(false);
  });
});
