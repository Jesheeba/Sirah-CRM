import { describe, it, expect } from "vitest";
import { extractVariables, validateTemplate, type TemplateComponent } from "@/lib/whatsapp-template-validator";

function body(text: string, example?: string[]): TemplateComponent {
  return { type: "BODY", text, ...(example ? { example: { body_text: [example] } } : {}) };
}

const BASE = { name: "order_update", language: "en_US", category: "UTILITY" as const };

describe("extractVariables", () => {
  it("returns sorted unique variable indices", () => {
    expect(extractVariables("Hi {{2}}, order {{1}} shipped. Thanks {{2}}!")).toEqual([1, 2]);
  });
  it("returns an empty array when there are none", () => {
    expect(extractVariables("Hi there")).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("accepts a well-formed template", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("Hi {{1}}, your order {{2}} has shipped.", ["Asha", "#1042"])],
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejects names with anything but lowercase/digits/underscore", () => {
    const res = validateTemplate({ ...BASE, name: "Order-Update", components: [body("Hi there.")] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("rejects a variable at the very start of the body", () => {
    const res = validateTemplate({ ...BASE, components: [body("{{1}}, your order has shipped.", ["Asha"])] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("start or end"))).toBe(true);
  });

  it("rejects a variable at the very end of the body", () => {
    const res = validateTemplate({ ...BASE, components: [body("Your order has shipped, {{1}}", ["Asha"])] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("start or end"))).toBe(true);
  });

  it("rejects non-sequential variables", () => {
    const res = validateTemplate({ ...BASE, components: [body("Hi {{1}}, order {{3}} shipped.", ["Asha", "#1042"])] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("sequential"))).toBe(true);
  });

  it("rejects variables not starting at {{1}}", () => {
    const res = validateTemplate({ ...BASE, components: [body("Order {{2}} shipped to you.", ["#1042"])] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("sequential"))).toBe(true);
  });

  it("rejects a missing example value for a variable", () => {
    const res = validateTemplate({ ...BASE, components: [body("Hi {{1}}, your order shipped.")] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("example value"))).toBe(true);
  });

  it("requires body text", () => {
    const res = validateTemplate({ ...BASE, components: [] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Body text is required"))).toBe(true);
  });
});
