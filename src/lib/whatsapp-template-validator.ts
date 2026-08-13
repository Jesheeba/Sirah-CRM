// Pure, framework-agnostic validation for WhatsApp Business message templates.
// Runs both client-side (instant feedback in the create form) and server-side
// (defense in depth before we ever call Meta) — no DB or network access here.
// Duplicate name+language is checked separately (needs a DB query), see actions.ts.

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export const TEMPLATE_CATEGORIES: Array<{
  value: TemplateCategory;
  label: string;
  costNote: string;
}> = [
  {
    value: "UTILITY",
    label: "Utility",
    costNote: "Cheapest per-message rate — transactional updates the customer expects (order status, appointment reminders, account alerts).",
  },
  {
    value: "MARKETING",
    label: "Marketing",
    costNote: "Highest per-message rate — promotions and proactive outreach. Requires the recipient to have opted in.",
  },
  {
    value: "AUTHENTICATION",
    label: "Authentication",
    costNote: "Flat, low per-message rate — one-time passcodes only. Meta enforces a fixed OTP-style layout.",
  },
];

/** A single named-parameter example, e.g. { param_name: "first_name", example: "Pablo" }. */
export interface NamedParamExample {
  param_name: string;
  example: string;
}

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone_number?: string;
  /** At most one — Meta allows only one variable in a dynamic URL button. */
  example?: NamedParamExample;
}

export interface TemplateHeaderComponent {
  type: "HEADER";
  format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  example?: { header_text_named_params?: NamedParamExample[]; header_handle?: string[] };
}

export interface TemplateBodyComponent {
  type: "BODY";
  text: string;
  example?: { body_text_named_params?: NamedParamExample[] };
}

export interface TemplateFooterComponent {
  type: "FOOTER";
  text: string;
}

export interface TemplateButtonsComponent {
  type: "BUTTONS";
  buttons: TemplateButton[];
}

export type TemplateComponent =
  | TemplateHeaderComponent
  | TemplateBodyComponent
  | TemplateFooterComponent
  | TemplateButtonsComponent;

export interface TemplateInput {
  name: string;
  language: string;
  category: TemplateCategory | "";
  components: TemplateComponent[];
}

const NAME_RE = /^[a-z0-9_]+$/;
// Meta moved from positional {{1}} to named {{customer_name}} parameters — capture
// whatever's between the braces (not just digits) so a malformed name still gets
// caught and reported, rather than silently failing to match at all.
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
// Meta's own rule: "Parameters using the named format must be unique, single strings,
// composed of lowercase characters and underscores" (numbers are also accepted).
const PARAM_NAME_RE = /^[a-z0-9_]+$/;
// PARAM_NAME_RE alone lets a purely-numeric token like "1" through, since digits are a
// valid character class member — that's indistinguishable from the old positional
// {{1}} syntax Meta no longer accepts, so it needs its own explicit rejection.
const PURELY_NUMERIC_RE = /^[0-9]+$/;

/** Unique parameter names referenced in `text`, in first-occurrence order. */
export function extractVariables(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function startsOrEndsWithVariable(text: string): boolean {
  const trimmed = text.trim();
  return /^\{\{[^{}]*\}\}/.test(trimmed) || /\{\{[^{}]*\}\}$/.test(trimmed);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Client-side-blockable validation rules — everything Meta would reject anyway,
 *  checked before we burn a submission attempt. Duplicate name+language is NOT
 *  checked here (needs the tenant's existing rows — see checkDuplicate in actions.ts). */
export function validateTemplate(input: TemplateInput): ValidationResult {
  const errors: string[] = [];

  if (!input.name.trim()) {
    errors.push("Template name is required.");
  } else if (!NAME_RE.test(input.name)) {
    errors.push("Template name may only contain lowercase letters, numbers, and underscores.");
  }

  if (!input.language.trim()) errors.push("Language is required.");
  if (!input.category) errors.push("Category is required.");

  const allVarNames: string[] = [];

  function checkParamNames(names: string[], where: string) {
    for (const name of names) {
      allVarNames.push(name);
      if (!PARAM_NAME_RE.test(name)) {
        errors.push(`The variable "{{${name}}}" in the ${where} may only contain lowercase letters, numbers, and underscores.`);
      } else if (PURELY_NUMERIC_RE.test(name)) {
        errors.push(
          `The variable "{{${name}}}" in the ${where} is a purely numeric name — Meta no longer supports positional parameters like {{1}}; use a descriptive name instead, e.g. {{customer_name}}.`,
        );
      }
    }
  }

  const body = input.components.find((c): c is TemplateBodyComponent => c.type === "BODY");
  if (!body || !body.text.trim()) {
    errors.push("Body text is required.");
  } else {
    if (startsOrEndsWithVariable(body.text)) {
      errors.push("Body text cannot start or end with a variable — Meta rejects this automatically.");
    }
    const vars = extractVariables(body.text);
    checkParamNames(vars, "body");
    if (vars.length > 0) {
      const examples = body.example?.body_text_named_params ?? [];
      const missing = vars.some((name) => !examples.find((e) => e.param_name === name)?.example?.trim());
      if (missing) {
        errors.push("Every body variable needs an example value.");
      }
    }
  }

  const header = input.components.find((c): c is TemplateHeaderComponent => c.type === "HEADER");
  if (header?.format === "TEXT" && header.text) {
    const vars = extractVariables(header.text);
    checkParamNames(vars, "header");
    if (vars.length > 1) {
      errors.push("Header text supports at most one variable.");
    } else if (vars.length === 1) {
      const example = header.example?.header_text_named_params?.[0];
      if (!example || example.param_name !== vars[0] || !example.example?.trim()) {
        errors.push("The header variable needs an example value.");
      }
    }
  }

  for (const btn of input.components.find((c): c is TemplateButtonsComponent => c.type === "BUTTONS")?.buttons ?? []) {
    if (!btn.text.trim()) errors.push("Every button needs label text.");
    if (btn.type === "URL") {
      if (!btn.url?.trim()) errors.push("URL buttons need a URL.");
      else {
        const vars = extractVariables(btn.url);
        checkParamNames(vars, "button URL");
        if (vars.length > 1) errors.push("URL buttons support at most one variable.");
        else if (vars.length === 1 && (!btn.example || btn.example.param_name !== vars[0] || !btn.example.example?.trim())) {
          errors.push("The URL button variable needs an example value.");
        }
      }
    }
    if (btn.type === "PHONE_NUMBER" && !btn.phone_number?.trim()) {
      errors.push("Phone number buttons need a phone number.");
    }
  }

  // A single leftover {{1}} from before the named-parameter switch is easy to miss
  // amid otherwise-correct {{customer_name}} params — each numeric one is already
  // flagged above, but call out the mix explicitly since Meta requires one style
  // throughout a template, not a per-parameter choice.
  const hasNumeric = allVarNames.some((n) => PURELY_NUMERIC_RE.test(n));
  const hasNamed = allVarNames.some((n) => PARAM_NAME_RE.test(n) && !PURELY_NUMERIC_RE.test(n));
  if (hasNumeric && hasNamed) {
    errors.push(
      "This template mixes numbered (e.g. {{1}}) and named (e.g. {{customer_name}}) parameters — use one style throughout the whole template.",
    );
  }

  return { valid: errors.length === 0, errors };
}

// ---- Send-time parameter shapes (POST /{phone-number-id}/messages) ----------
// Meta's docs confirm these for BODY named parameters; HEADER is inferred by direct
// analogy (same TextParameterObject shape reused across components in the send API —
// not shown with its own named-format example in Meta's docs). BUTTONS/URL named
// parameters aren't documented at all; kept consistent with body/header rather than
// left positional, since parameter_format is declared once per template, not
// per-component — flagged here for anyone verifying against a live send.
export interface SendTemplateTextParameter {
  type: "text";
  parameter_name: string;
  text: string;
}

export interface SendTemplateBodyComponent {
  type: "body";
  parameters: SendTemplateTextParameter[];
}

export interface SendTemplateHeaderComponent {
  type: "header";
  parameters: SendTemplateTextParameter[];
}

export interface SendTemplateButtonComponent {
  type: "button";
  sub_type: "url" | "quick_reply";
  index: string;
  parameters: SendTemplateTextParameter[];
}

export type SendTemplateComponent =
  | SendTemplateBodyComponent
  | SendTemplateHeaderComponent
  | SendTemplateButtonComponent;
