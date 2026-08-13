import { describe, it, expect } from "vitest";
import { extractVariables, validateTemplate, type TemplateComponent } from "@/lib/whatsapp-template-validator";

function body(text: string, examples?: Record<string, string>): TemplateComponent {
  return {
    type: "BODY",
    text,
    ...(examples
      ? { example: { body_text_named_params: Object.entries(examples).map(([param_name, example]) => ({ param_name, example })) } }
      : {}),
  };
}

const BASE = { name: "order_update", language: "en_US", category: "UTILITY" as const };

describe("extractVariables", () => {
  it("returns unique named parameters in first-occurrence order", () => {
    expect(extractVariables("Hi {{customer_name}}, order {{order_number}} shipped. Thanks {{customer_name}}!")).toEqual([
      "customer_name",
      "order_number",
    ]);
  });
  it("returns an empty array when there are none", () => {
    expect(extractVariables("Hi there")).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("accepts a well-formed named-parameter template", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("Hi {{customer_name}}, your order {{order_number}} has shipped.", { customer_name: "Asha", order_number: "#1042" })],
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejects template names with anything but lowercase/digits/underscore", () => {
    const res = validateTemplate({ ...BASE, name: "Order-Update", components: [body("Hi there.")] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("rejects a parameter name with anything but lowercase/digits/underscore", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("Hi {{Customer Name}}, your order shipped.", { "Customer Name": "Asha" })],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('"{{Customer Name}}"') && e.includes("lowercase"))).toBe(true);
  });

  it("rejects a purely numeric parameter name (old positional syntax)", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("Hi there, your order {{1}} has shipped.", { "1": "#1042" })],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('"{{1}}"') && e.includes("purely numeric"))).toBe(true);
    // Charset error must NOT also fire for a numeric name — digits alone satisfy the
    // charset, so it's the more specific "purely numeric" message or nothing.
    expect(res.errors.some((e) => e.includes('"{{1}}"') && e.includes("may only contain"))).toBe(false);
  });

  it("rejects a template that mixes numbered and named parameters", () => {
    const res = validateTemplate({
      ...BASE,
      components: [
        body("Hi {{customer_name}}, your order {{1}} has shipped.", { customer_name: "Asha", "1": "#1042" }),
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("mixes numbered") && e.includes("named"))).toBe(true);
  });

  it("does not flag mixing when every parameter is named", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("Hi {{customer_name}}, your order {{order_number}} has shipped.", { customer_name: "Asha", order_number: "#1042" })],
    });
    expect(res.errors.some((e) => e.includes("mixes numbered"))).toBe(false);
  });

  it("rejects a variable at the very start of the body", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("{{customer_name}}, your order has shipped.", { customer_name: "Asha" })],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("start or end"))).toBe(true);
  });

  it("rejects a variable at the very end of the body", () => {
    const res = validateTemplate({
      ...BASE,
      components: [body("Your order has shipped, {{customer_name}}", { customer_name: "Asha" })],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("start or end"))).toBe(true);
  });

  it("does not require sequential or {{1}}-first numbering (named params only)", () => {
    // Two named params in any order/naming is fine — no positional sequencing rule applies.
    const res = validateTemplate({
      ...BASE,
      components: [
        body("Hi {{customer_name}}, order {{order_number}} shipped.", { customer_name: "Asha", order_number: "#1042" }),
      ],
    });
    expect(res.errors.some((e) => e.toLowerCase().includes("sequential"))).toBe(false);
  });

  it("rejects a missing example value for a variable", () => {
    const res = validateTemplate({ ...BASE, components: [body("Hi {{customer_name}}, your order shipped.")] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("example value"))).toBe(true);
  });

  it("requires body text", () => {
    const res = validateTemplate({ ...BASE, components: [] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Body text is required"))).toBe(true);
  });

  it("rejects an invalid header parameter name", () => {
    const res = validateTemplate({
      ...BASE,
      components: [
        {
          type: "HEADER",
          format: "TEXT",
          text: "Update for {{Order}}",
          example: { header_text_named_params: [{ param_name: "Order", example: "#1042" }] },
        },
        body("Hi there, your order shipped."),
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('"{{Order}}"'))).toBe(true);
  });

  it("rejects a URL button variable missing an example", () => {
    const res = validateTemplate({
      ...BASE,
      components: [
        body("Hi there, your order shipped."),
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Track", url: "https://example.com/{{tracking_id}}" }] },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("URL button variable"))).toBe(true);
  });

  it("accepts a URL button variable with an example", () => {
    const res = validateTemplate({
      ...BASE,
      components: [
        body("Hi there, your order shipped."),
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "URL",
              text: "Track",
              url: "https://example.com/{{tracking_id}}",
              example: { param_name: "tracking_id", example: "abc123" },
            },
          ],
        },
      ],
    });
    expect(res.valid).toBe(true);
  });
});
