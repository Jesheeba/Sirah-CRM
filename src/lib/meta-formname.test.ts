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

describe("fetchAdName token preference", () => {
  const origEnv = process.env.META_ADS_TOKEN;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.META_ADS_TOKEN;
    else process.env.META_ADS_TOKEN = origEnv;
  });

  /** The tokens each Graph call was made with, in order. */
  const captureTokens = (replies: Array<{ ok: boolean; name?: string }>) => {
    const used: string[] = [];
    let i = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: URL) => {
        used.push(new URL(url).searchParams.get("access_token") ?? "");
        const r = replies[i++] ?? { ok: false };
        return Promise.resolve({
          ok: r.ok,
          status: r.ok ? 200 : 400,
          json: async () => (r.ok ? { name: r.name } : { error: { message: "(#275) no ads access" } }),
        });
      }),
    );
    return used;
  };

  it("uses the system-user token first when one is configured", async () => {
    process.env.META_ADS_TOKEN = "sys-token";
    const used = captureTokens([{ ok: true, name: "keerthi_housewife" }]);
    expect(await fetchAdName("444", "page-token")).toBe("keerthi_housewife");
    expect(used).toEqual(["sys-token"]); // the page token is never reached
  });

  it("falls back to the page token when the system-user token is refused", async () => {
    process.env.META_ADS_TOKEN = "sys-token";
    const used = captureTokens([{ ok: false }, { ok: true, name: "pranesh_ads" }]);
    expect(await fetchAdName("444", "page-token")).toBe("pranesh_ads");
    expect(used).toEqual(["sys-token", "page-token"]);
  });

  it("uses only the page token when no system-user token is set", async () => {
    delete process.env.META_ADS_TOKEN;
    const used = captureTokens([{ ok: true, name: "reswana mam" }]);
    expect(await fetchAdName("444", "page-token")).toBe("reswana mam");
    expect(used).toEqual(["page-token"]);
  });

  it("returns null when both tokens are refused, so the lead keeps its ad id", async () => {
    process.env.META_ADS_TOKEN = "sys-token";
    const used = captureTokens([{ ok: false }, { ok: false }]);
    expect(await fetchAdName("444", "page-token")).toBeNull();
    expect(used).toEqual(["sys-token", "page-token"]);
  });
});
