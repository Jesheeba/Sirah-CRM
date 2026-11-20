import { describe, it, expect } from "vitest";
import { leadEventBlocksImport } from "./meta";

// "Import past leads" must re-import leads whose live webhook delivery failed.
describe("leadEventBlocksImport", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();

  it("skips a lead that was already created", () => {
    expect(leadEventBlocksImport("created", ago(60 * 24), now)).toBe(true);
  });
  it("re-imports a lead whose webhook delivery failed (e.g. expired page token)", () => {
    expect(leadEventBlocksImport("error", ago(5), now)).toBe(false);
  });
  it("re-imports a lead skipped because the page was not enabled", () => {
    expect(leadEventBlocksImport("skipped", ago(5), now)).toBe(false);
  });
  it("leaves a lead alone while a webhook is still processing it (< 10 min)", () => {
    expect(leadEventBlocksImport("received", ago(2), now)).toBe(true);
  });
  it("re-imports a delivery stuck in 'received' for 10+ minutes", () => {
    expect(leadEventBlocksImport("received", ago(11), now)).toBe(false);
  });
});
