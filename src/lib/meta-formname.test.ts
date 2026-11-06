import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdName, fetchFormName } from "./meta";

const stubFetch = (res: Partial<Response> & { json?: () => Promise<unknown> }) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), ...res }));

afterEach(() => vi.unstubAllGlobals());

describe("fetchFormName", () => {
  it("returns the trimmed form name", async () => {
    stubFetch({ json: async () => ({ id: "1", name: "  Graphic design batch Nov " }) });
    expect(await fetchFormName("1", "tok")).toBe("Graphic design batch Nov");
  });
  it("returns null when Meta rejects the call, so the lead is still saved", async () => {
    stubFetch({ ok: false, status: 400, json: async () => ({ error: { message: "(#200) permission" } }) });
    expect(await fetchFormName("1", "tok")).toBeNull();
  });
  it("returns null for a missing or blank name", async () => {
    stubFetch({ json: async () => ({ id: "1", name: "  " }) });
    expect(await fetchFormName("1", "tok")).toBeNull();
  });
  it("returns null when the network call throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchFormName("1", "tok")).toBeNull();
  });
});

describe("fetchAdName", () => {
  it("returns the trimmed ad name", async () => {
    stubFetch({ json: async () => ({ id: "444", name: " Nov batch - carousel A " }) });
    expect(await fetchAdName("444", "tok")).toBe("Nov batch - carousel A");
  });
  // A Page token often lacks ads-level read access; the ad id alone must still be stored.
  it("returns null when Meta refuses the ad node, so the lead is still saved", async () => {
    stubFetch({ ok: false, status: 400, json: async () => ({ error: { message: "(#275) ads_read" } }) });
    expect(await fetchAdName("444", "tok")).toBeNull();
  });
  it("returns null for a missing or blank name", async () => {
    stubFetch({ json: async () => ({ id: "444" }) });
    expect(await fetchAdName("444", "tok")).toBeNull();
  });
  it("returns null when the network call throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchAdName("444", "tok")).toBeNull();
  });
});
