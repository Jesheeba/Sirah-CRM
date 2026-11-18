import { describe, expect, it } from "vitest";
import { allowedChannels, canApprove, checkWindow, initialStatus, validateBody } from "./ig-reply";

const NOW = new Date("2026-11-18T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("F4 channels per item", () => {
  it("comments: public or private; DMs: message; tags: nothing", () => {
    expect(allowedChannels({ kind: "comment", at: null, mediaId: "m" })).toEqual(["public", "private"]);
    expect(allowedChannels({ kind: "dm", at: null, mediaId: null })).toEqual(["dm"]);
    expect(allowedChannels({ kind: "tag", at: null, mediaId: "m" })).toEqual([]);
  });
  it("comment mentions can be answered publicly; caption mentions can't", () => {
    expect(allowedChannels({ kind: "mention", at: null, mediaId: "m" })).toEqual(["public"]);
    expect(allowedChannels({ kind: "mention", at: null, mediaId: "m", captionMention: true })).toEqual([]);
    expect(allowedChannels({ kind: "mention", at: null, mediaId: null })).toEqual([]);
  });
});

describe("F4 Instagram windows", () => {
  it("DM within 24 h is allowed, after 24 h refused", () => {
    expect(checkWindow("dm", ago(23), NOW).ok).toBe(true);
    expect(checkWindow("dm", ago(25), NOW).ok).toBe(false);
  });
  it("private reply within 7 days, once", () => {
    expect(checkWindow("private", ago(24 * 6), NOW).ok).toBe(true);
    expect(checkWindow("private", ago(24 * 8), NOW).ok).toBe(false);
    expect(checkWindow("private", ago(1), NOW, true).ok).toBe(false);
  });
  it("public replies have no window; unknown time blocks DMs", () => {
    expect(checkWindow("public", null, NOW).ok).toBe(true);
    expect(checkWindow("dm", null, NOW).ok).toBe(false);
  });
});

describe("F4 reply text", () => {
  it("trims, rejects empty, enforces per-channel limits (counting emoji as one)", () => {
    expect(validateBody("  hi  ", "public")).toEqual({ ok: true, body: "hi" });
    expect(validateBody("   ", "dm").ok).toBe(false);
    expect(validateBody("x".repeat(1001), "dm").ok).toBe(false);
    expect(validateBody("x".repeat(1001), "public").ok).toBe(true);
    expect(validateBody("🙏".repeat(1000), "dm").ok).toBe(true);
  });
});

describe("F4 who approves", () => {
  const admin = { userId: "a", isAdmin: true, isManager: false };
  const manager = { userId: "m", isAdmin: false, isManager: true };
  const rep = { userId: "r", isAdmin: false, isManager: false };
  it("admins and managers approve others' replies; reps never", () => {
    expect(canApprove(admin, "r", false).ok).toBe(true);
    expect(canApprove(manager, "r", false).ok).toBe(true);
    expect(canApprove(rep, "a", true).ok).toBe(false);
  });
  it("the writer can't approve their own reply unless the org allows it", () => {
    expect(canApprove(admin, "a", false).ok).toBe(false);
    expect(canApprove(admin, "a", true).ok).toBe(true);
  });
  it("direct mode posts at once only for admins/managers", () => {
    expect(initialStatus("direct", admin)).toBe("send_now");
    expect(initialStatus("direct", rep)).toBe("pending_approval");
    expect(initialStatus("human_approval", admin)).toBe("pending_approval");
  });
});
