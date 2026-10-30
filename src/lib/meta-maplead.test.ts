import { describe, it, expect } from "vitest";
import { mapLead } from "./meta";

const detail = (fields: Record<string, string>, platform = "fb") => ({
  field_data: Object.entries(fields).map(([name, v]) => ({ name, values: [v] })),
  platform,
});

describe("mapLead", () => {
  it("maps Meta's standard question names", () => {
    const m = mapLead(detail({ full_name: "Asha Devi", email: "a@x.com", phone_number: "+911", company_name: "Acme" }));
    expect(m).toMatchObject({ first_name: "Asha", last_name: "Devi", email: "a@x.com", phone: "+911", company: "Acme" });
    expect(m.answers).toEqual({});
  });

  it("puts a plain `phone` question in the phone column, not in custom answers", () => {
    const m = mapLead(detail({ full_name: "Karthik", phone: "+919876543210", city: "Attur" }));
    expect(m.phone).toBe("+919876543210");
    expect(m.answers).toEqual({ city: "Attur" });
  });

  it("accepts other common phone/email names", () => {
    expect(mapLead(detail({ mobile_number: "123" })).phone).toBe("123");
    expect(mapLead(detail({ whatsapp_number: "456" })).phone).toBe("456");
    expect(mapLead(detail({ email_address: "b@x.com" })).email).toBe("b@x.com");
  });

  it("prefers the standard name when both variants are present", () => {
    expect(mapLead(detail({ phone: "111", phone_number: "222" })).phone).toBe("222");
  });

  it("ignores blank answers and tags Instagram leads", () => {
    const m = mapLead(detail({ phone: "   ", city: "" }, "ig"));
    expect(m.phone).toBeNull();
    expect(m.answers).toEqual({});
    expect(m.source).toBe("Instagram Lead Ads");
  });
});
