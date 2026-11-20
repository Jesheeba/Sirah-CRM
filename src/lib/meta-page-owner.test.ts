import { describe, it, expect } from "vitest";
import { pagesForTenant } from "./meta";

// Incident 2026-11-20: connecting TNPSC Mentors from Sirah Digital with a Facebook admin who also
// manages RD Interlock Bricks moved RD's page into Sirah's workspace; disconnecting there removed it.
describe("pagesForTenant — never move a client's page to another workspace", () => {
  const pages = [{ id: "tnpsc" }, { id: "rd" }, { id: "new" }];
  const existing = [
    { page_id: "tnpsc", tenant_id: "sirah" },
    { page_id: "rd", tenant_id: "rd-tenant" },
  ];

  it("keeps pages already in this workspace and new pages; leaves another workspace's page alone", () => {
    const r = pagesForTenant(pages, existing, "sirah");
    expect(r.mine.map((p) => p.id)).toEqual(["tnpsc", "new"]);
    expect(r.taken.map((p) => p.id)).toEqual(["rd"]);
  });

  it("the owning workspace can still reconnect its own page", () => {
    expect(pagesForTenant(pages, existing, "rd-tenant").mine.map((p) => p.id)).toEqual(["rd", "new"]);
  });

  it("a page row with no tenant is treated as free", () => {
    expect(pagesForTenant([{ id: "x" }], [{ page_id: "x", tenant_id: null }], "sirah").mine).toHaveLength(1);
  });
});
