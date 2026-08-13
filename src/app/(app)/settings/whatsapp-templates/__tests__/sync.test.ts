import { describe, it, expect, vi } from "vitest";
import { syncTemplates } from "../actions";
import { getUserContext } from "@/lib/auth";
import { resolveWhatsAppConfig } from "@/lib/integrations";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMetaTemplates } from "@/lib/whatsapp-templates";
import { FakeAdmin } from "@/lib/__tests__/fake-admin";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn() }));
vi.mock("@/lib/integrations", () => ({ resolveWhatsAppConfig: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/whatsapp-templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp-templates")>();
  return { ...actual, listMetaTemplates: vi.fn() };
});

const CTX = {
  userId: "user-1",
  email: "admin@acme.test",
  role: "Admin" as const,
  tenantId: "tenant-a",
  tenantName: "Acme",
  tenantStatus: "active",
  isAdmin: true,
  isManager: false,
  isRep: false,
  isPlatformAdmin: false,
};

const CFG = {
  mode: "tenant_cloud" as const,
  phoneId: "phone-1",
  accessToken: "token-1",
  wabaId: "waba-1",
};

/** Seeds the mocked auth/config/admin-client chain that requireAdminWithCloudApi() needs. */
function setup(rows: Record<string, unknown>[]) {
  const tables: Record<string, Record<string, unknown>[]> = { whatsapp_templates: rows };
  const admin = new FakeAdmin(tables);
  vi.mocked(getUserContext).mockResolvedValue(CTX);
  vi.mocked(resolveWhatsAppConfig).mockResolvedValue(CFG);
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);
  return tables;
}

function localRow(overrides: Record<string, unknown>) {
  return {
    id: overrides.id ?? "row-" + Math.random(),
    tenant_id: "tenant-a",
    waba_id: "waba-1",
    owner_id: "user-1",
    category: "UTILITY",
    rejection_reason: null,
    quality_score: null,
    submitted_at: null,
    reviewed_at: null,
    orphaned_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("syncTemplates", () => {
  it("inserts a template that exists on Meta but not locally", async () => {
    const tables = setup([]);
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        id: "meta-1",
        name: "order_confirmation",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi {{customer_name}}, your order shipped." }],
      },
    ]);

    const result = await syncTemplates();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(tables.whatsapp_templates).toHaveLength(1);
    const row = tables.whatsapp_templates[0];
    expect(row.name).toBe("order_confirmation");
    expect(row.status).toBe("APPROVED");
    expect(row.meta_template_id).toBe("meta-1");
    expect(row.tenant_id).toBe("tenant-a");
    expect(row.owner_id).toBe("user-1");
  });

  it("updates status on a template that exists in both places", async () => {
    const tables = setup([
      localRow({
        id: "row-1",
        name: "order_confirmation",
        language: "en_US",
        status: "PENDING",
        meta_template_id: "meta-1",
        components: [{ type: "BODY", text: "Hi {{customer_name}}, your order shipped." }],
      }),
    ]);
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        id: "meta-1",
        name: "order_confirmation",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi {{customer_name}}, your order shipped." }],
      },
    ]);

    const result = await syncTemplates();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(tables.whatsapp_templates).toHaveLength(1);
    expect(tables.whatsapp_templates[0].status).toBe("APPROVED");
  });

  it("does not clobber a local DRAFT that was never submitted to Meta", async () => {
    const tables = setup([
      localRow({
        id: "row-2",
        name: "order_confirmation",
        language: "en_US",
        status: "DRAFT",
        meta_template_id: null,
        components: [{ type: "BODY", text: "Work in progress {{x}}" }],
      }),
    ]);
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        id: "meta-9",
        name: "order_confirmation",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Already-approved content." }],
      },
    ]);

    const result = await syncTemplates();

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(tables.whatsapp_templates).toHaveLength(1);
    const row = tables.whatsapp_templates[0];
    expect(row.status).toBe("DRAFT");
    expect(row.meta_template_id).toBe(null);
    expect(row.components).toEqual([{ type: "BODY", text: "Work in progress {{x}}" }]);
  });

  it("handles a variable-less template (hello_world has no example object)", async () => {
    const tables = setup([]);
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        id: "meta-hw",
        name: "hello_world",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hello World" }],
      },
    ]);

    const result = await syncTemplates();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);
    expect(tables.whatsapp_templates[0].components).toEqual([{ type: "BODY", text: "Hello World" }]);
  });

  it("stores older numbered {{1}} parameters as-is, without converting or rejecting them", async () => {
    const tables = setup([]);
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        id: "meta-old",
        name: "legacy_notice",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi {{1}}, your code is {{2}}." }],
      },
    ]);

    const result = await syncTemplates();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);
    expect(tables.whatsapp_templates[0].components).toEqual([
      { type: "BODY", text: "Hi {{1}}, your code is {{2}}." },
    ]);
  });

  it("is idempotent across two consecutive runs — no duplicates", async () => {
    const tables = setup([]);
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        id: "meta-1",
        name: "order_confirmation",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi {{customer_name}}, your order shipped." }],
      },
      {
        id: "meta-hw",
        name: "hello_world",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hello World" }],
      },
    ]);

    const first = await syncTemplates();
    expect(first.inserted).toBe(2);
    expect(first.updated).toBe(0);
    expect(tables.whatsapp_templates).toHaveLength(2);

    const second = await syncTemplates();
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(2);
    expect(tables.whatsapp_templates).toHaveLength(2);
  });
});
