import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { META_SCOPES_FACEBOOK, META_SCOPES_INSTAGRAM } from "./meta";

// App Review: every permission the Connect buttons request must be approved or in the
// submission, and listed on the privacy page — a requested-but-unsubmitted scope is a mismatch.
const APPROVED = ["pages_show_list", "pages_manage_metadata", "business_management", "pages_read_engagement", "leads_retrieval"];
const IN_SUBMISSION = ["pages_manage_ads", "instagram_basic", "instagram_manage_comments", "instagram_manage_messages"];

describe("F10 scopes match the App Review submission", () => {
  const requested = [...META_SCOPES_FACEBOOK.split(","), ...META_SCOPES_INSTAGRAM.split(",")];

  it("does not request ads_management (decision 2026-11-18)", () => {
    expect(requested).not.toContain("ads_management");
  });
  it("requests only approved or submitted permissions", () => {
    for (const s of requested) expect([...APPROVED, ...IN_SUBMISSION]).toContain(s);
  });
  it("the privacy page explains every requested permission and no longer lists ads_management", () => {
    const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
    for (const s of new Set(requested)) expect(privacy).toContain(s);
    expect(privacy).not.toContain("ads_management");
  });
});
